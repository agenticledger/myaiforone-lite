/**
 * MemoryManager — orchestrates advanced memory for agents.
 * - Semantic search over stored memories
 * - Daily memory logging
 * - Auto-compaction (prompts agent to save before context grows too large)
 * - Indexes context.md, daily logs, and conversation exchanges
 */

import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getEmbeddingProvider, buildVocab, type EmbeddingProvider } from "./embeddings.js";
import { createStore, type VectorStore, type MemoryChunk } from "./store.js";
import { hybridSearch, formatSearchResults, type SearchResult } from "./search.js";
import { appendDailyEntry, loadRecentDaily, listDailyFiles } from "./daily.js";
import { log } from "../logger.js";

export interface MemoryManager {
  /** Search memories relevant to a query */
  search(query: string, topK?: number): Promise<SearchResult[]>;

  /** Format search results for prompt injection */
  searchFormatted(query: string, topK?: number): Promise<string>;

  /** Index a new text chunk into memory */
  index(text: string, source: string, metadata?: Record<string, string>): Promise<void>;

  /** Index a conversation exchange */
  indexExchange(userMessage: string, agentResponse: string, sender: string): Promise<void>;

  /** Load recent daily context */
  loadDailyContext(): string;

  /** Re-index all memory sources (context.md + daily files) */
  reindex(): Promise<void>;

  /** Get auto-compaction prompt if needed */
  getCompactionPrompt(messageCount: number): string | null;

  /** Get memory stats */
  stats(): Promise<{ chunks: number; store: string; embeddings: string }>;
}

// ─── Chunk text into ~400 token pieces ───────────────────────────────

function chunkText(text: string, maxChars: number = 1200): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += para + "\n\n";
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

// ─── Auto-compaction thresholds ──────────────────────────────────────

const COMPACTION_WARN_MESSAGES = 20;   // suggest compaction after 20 messages
const COMPACTION_FORCE_MESSAGES = 40;  // strongly suggest after 40

// ─── Create MemoryManager ────────────────────────────────────────────

export async function createMemoryManager(memoryDir: string): Promise<MemoryManager> {
  const embedder = getEmbeddingProvider();
  const store = await createStore(memoryDir);
  const contextPath = join(memoryDir, "context.md");

  // Initial index if store is empty
  const count = await store.count();
  if (count === 0) {
    log.info(`Memory: empty store, indexing existing files...`);
    await indexExistingFiles(memoryDir, contextPath, embedder, store);
  }

  return {
    async search(query: string, topK = 5): Promise<SearchResult[]> {
      const queryVector = await embedder.embed(query);
      const allChunks = await store.getAll();
      return hybridSearch(queryVector, query, allChunks, { topK });
    },

    async searchFormatted(query: string, topK = 5): Promise<string> {
      const queryVector = await embedder.embed(query);
      const allChunks = await store.getAll();
      const results = hybridSearch(queryVector, query, allChunks, { topK });
      return formatSearchResults(results);
    },

    async index(text: string, source: string, metadata?: Record<string, string>): Promise<void> {
      const chunks = chunkText(text);
      const vectors = await embedder.embedBatch(chunks);

      const memoryChunks: MemoryChunk[] = chunks.map((text, i) => ({
        id: `${source}-${randomUUID().slice(0, 8)}`,
        text,
        vector: vectors[i],
        source,
        timestamp: new Date().toISOString(),
        metadata,
      }));

      await store.addBatch(memoryChunks);
    },

    async indexExchange(userMessage: string, agentResponse: string, sender: string): Promise<void> {
      // Log to daily file
      appendDailyEntry(memoryDir, sender, userMessage, agentResponse);

      // Index the exchange as a memory chunk
      const summary = `User (${sender}): ${userMessage.slice(0, 200)}\nAgent: ${agentResponse.slice(0, 400)}`;
      const vector = await embedder.embed(summary);

      await store.add({
        id: `conv-${Date.now()}`,
        text: summary,
        vector,
        source: "conversation",
        timestamp: new Date().toISOString(),
        metadata: { sender },
      });
    },

    loadDailyContext(): string {
      return loadRecentDaily(memoryDir);
    },

    async reindex(): Promise<void> {
      await store.clear();
      await indexExistingFiles(memoryDir, contextPath, embedder, store);
      log.info(`Memory: reindexed`);
    },

    getCompactionPrompt(messageCount: number): string | null {
      if (messageCount >= COMPACTION_FORCE_MESSAGES) {
        return `[SYSTEM: Your conversation has reached ${messageCount} messages. Before the context gets compressed, save any important decisions, facts, or context to ${contextPath} using the Write tool. Focus on: key decisions made, user preferences learned, project state, and anything you'd need to know if starting fresh. Merge with existing content — don't overwrite.]`;
      }
      if (messageCount >= COMPACTION_WARN_MESSAGES) {
        return `[SYSTEM: You're at ${messageCount} messages. Consider using /opcompact to save important context soon, or I'll remind you again at ${COMPACTION_FORCE_MESSAGES} messages.]`;
      }
      return null;
    },

    async stats() {
      return {
        chunks: await store.count(),
        store: store.name,
        embeddings: embedder.name,
      };
    },
  };
}

// ─── Index existing files into the store ─────────────────────────────

async function indexExistingFiles(
  memoryDir: string,
  contextPath: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
): Promise<void> {
  const allTexts: Array<{ text: string; source: string; timestamp: string }> = [];

  // Index context.md
  if (existsSync(contextPath)) {
    try {
      const content = readFileSync(contextPath, "utf-8").trim();
      if (content) {
        const chunks = chunkText(content);
        for (const chunk of chunks) {
          allTexts.push({ text: chunk, source: "context", timestamp: new Date().toISOString() });
        }
      }
    } catch { /* ignore */ }
  }

  // Index daily files
  const dailyFiles = listDailyFiles(memoryDir);
  for (const { path, date } of dailyFiles) {
    try {
      const content = readFileSync(path, "utf-8").trim();
      if (content) {
        const chunks = chunkText(content);
        for (const chunk of chunks) {
          allTexts.push({ text: chunk, source: "daily", timestamp: `${date}T00:00:00.000Z` });
        }
      }
    } catch { /* ignore */ }
  }

  if (allTexts.length === 0) return;

  // Build vocab for TF-IDF (if using local embeddings)
  buildVocab(allTexts.map(t => t.text));

  // Embed all at once
  const vectors = await embedder.embedBatch(allTexts.map(t => t.text));

  const memoryChunks: MemoryChunk[] = allTexts.map((t, i) => ({
    id: `${t.source}-${randomUUID().slice(0, 8)}`,
    text: t.text,
    vector: vectors[i],
    source: t.source,
    timestamp: t.timestamp,
  }));

  await store.addBatch(memoryChunks);
  log.info(`Memory: indexed ${memoryChunks.length} chunks from ${dailyFiles.length} daily files + context.md`);
}
