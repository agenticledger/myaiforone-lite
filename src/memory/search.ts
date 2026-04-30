/**
 * Hybrid semantic search: cosine similarity + BM25 keyword + temporal decay.
 */

import { cosineSimilarity } from "./embeddings.js";
import type { MemoryChunk } from "./store.js";

export interface SearchResult {
  chunk: MemoryChunk;
  score: number;         // combined score 0-1
  vectorScore: number;   // cosine similarity
  keywordScore: number;  // BM25-like score
  decayFactor: number;   // temporal decay multiplier
}

// ─── BM25 keyword scoring ────────────────────────────────────────────

const BM25_K1 = 1.2;
const BM25_B = 0.75;

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(t => t.length > 1);
}

function bm25Score(query: string, document: string, avgDocLen: number): number {
  const queryTokens = tokenize(query);
  const docTokens = tokenize(document);
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;

  const docLen = docTokens.length;
  const tf = new Map<string, number>();
  for (const t of docTokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }

  let score = 0;
  for (const qt of queryTokens) {
    const freq = tf.get(qt) || 0;
    if (freq === 0) continue;
    const numerator = freq * (BM25_K1 + 1);
    const denominator = freq + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLen));
    score += numerator / denominator;
  }

  // Normalize to 0-1 range (approximate)
  return Math.min(score / queryTokens.length, 1);
}

// ─── Temporal decay ──────────────────────────────────────────────────

const HALF_LIFE_DAYS = 30;
const DECAY_LAMBDA = Math.LN2 / HALF_LIFE_DAYS;

function temporalDecay(timestamp: string, source: string): number {
  // context.md and manual entries never decay
  if (source === "context" || source === "manual") return 1.0;

  const ageMs = Date.now() - new Date(timestamp).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.exp(-DECAY_LAMBDA * ageDays);
}

// ─── Hybrid search ───────────────────────────────────────────────────

export interface SearchOptions {
  topK?: number;           // max results (default 5)
  vectorWeight?: number;   // weight for vector score (default 0.6)
  keywordWeight?: number;  // weight for keyword score (default 0.3)
  decayWeight?: number;    // weight for temporal decay (default 0.1)
  minScore?: number;       // minimum combined score (default 0.1)
}

export function hybridSearch(
  queryVector: number[],
  queryText: string,
  chunks: MemoryChunk[],
  options: SearchOptions = {},
): SearchResult[] {
  const {
    topK = 5,
    vectorWeight = 0.6,
    keywordWeight = 0.3,
    decayWeight = 0.1,
    minScore = 0.1,
  } = options;

  if (chunks.length === 0) return [];

  // Average document length for BM25
  const avgDocLen = chunks.reduce((sum, c) => sum + tokenize(c.text).length, 0) / chunks.length;

  const results: SearchResult[] = chunks.map(chunk => {
    const vectorScore = cosineSimilarity(queryVector, chunk.vector);
    const keywordScore = bm25Score(queryText, chunk.text, avgDocLen);
    const decayFactor = temporalDecay(chunk.timestamp, chunk.source);

    const score =
      vectorWeight * vectorScore +
      keywordWeight * keywordScore +
      decayWeight * decayFactor;

    return { chunk, score, vectorScore, keywordScore, decayFactor };
  });

  return results
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ─── Format search results for prompt injection ──────────────────────

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "";

  const lines = ["[Relevant Memories]"];
  for (const r of results) {
    const date = r.chunk.timestamp.split("T")[0];
    const source = r.chunk.source;
    lines.push(`- [${date}/${source}] ${r.chunk.text}`);
  }
  lines.push("[/Relevant Memories]");
  return lines.join("\n");
}
