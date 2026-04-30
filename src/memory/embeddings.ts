/**
 * Embedding providers — auto-selects best available:
 * 1. OpenAI text-embedding-3-small (if OPENAI_API_KEY set)
 * 2. TF-IDF local (zero dependencies, always works)
 */

import { log } from "../logger.js";

export interface EmbeddingProvider {
  name: string;
  dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// ─── TF-IDF Local Provider (zero deps) ──────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "because", "but", "and", "or", "if", "while", "that", "this",
  "it", "its", "i", "me", "my", "we", "our", "you", "your", "he", "him",
  "his", "she", "her", "they", "them", "their", "what", "which", "who",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

// Global vocabulary built from all indexed texts
const globalVocab = new Map<string, number>(); // word -> index
let vocabSize = 0;

export function buildVocab(texts: string[]): void {
  for (const text of texts) {
    for (const token of tokenize(text)) {
      if (!globalVocab.has(token)) {
        globalVocab.set(token, vocabSize++);
      }
    }
  }
}

function tfidfVector(text: string): number[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return new Array(Math.max(vocabSize, 1)).fill(0);

  // Term frequency
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }

  // Build sparse vector
  const vec = new Array(Math.max(vocabSize, 1)).fill(0);
  for (const [word, count] of tf) {
    const idx = globalVocab.get(word);
    if (idx !== undefined) {
      vec[idx] = count / tokens.length; // normalized TF
    }
  }

  // L2 normalize
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }

  return vec;
}

class TFIDFProvider implements EmbeddingProvider {
  name = "tfidf-local";
  dimensions = 0; // dynamic, grows with vocab

  async embed(text: string): Promise<number[]> {
    buildVocab([text]);
    this.dimensions = vocabSize;
    return tfidfVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    buildVocab(texts);
    this.dimensions = vocabSize;
    return texts.map(t => tfidfVector(t));
  }
}

// ─── OpenAI Provider ─────────────────────────────────────────────────

class OpenAIProvider implements EmbeddingProvider {
  name = "openai-text-embedding-3-small";
  dimensions = 1536;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: texts,
        }),
      });

      if (!resp.ok) {
        log.warn(`OpenAI embeddings failed (${resp.status}), falling back to TF-IDF`);
        const fallback = new TFIDFProvider();
        return fallback.embedBatch(texts);
      }

      const data = await resp.json() as {
        data: Array<{ embedding: number[] }>;
      };

      return data.data.map(d => d.embedding);
    } catch (err) {
      log.warn(`OpenAI embeddings error: ${err}, falling back to TF-IDF`);
      const fallback = new TFIDFProvider();
      return fallback.embedBatch(texts);
    }
  }
}

// ─── Provider selection ──────────────────────────────────────────────

let cachedProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (cachedProvider) return cachedProvider;

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    cachedProvider = new OpenAIProvider(openaiKey);
    log.info(`Memory embeddings: OpenAI (text-embedding-3-small)`);
  } else {
    cachedProvider = new TFIDFProvider();
    log.info(`Memory embeddings: TF-IDF local (set OPENAI_API_KEY for better quality)`);
  }

  return cachedProvider;
}

// ─── Cosine similarity ───────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  // Handle mismatched dimensions (TF-IDF vocab can grow)
  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  // Include remaining dimensions in norms
  for (let i = len; i < a.length; i++) normA += a[i] * a[i];
  for (let i = len; i < b.length; i++) normB += b[i] * b[i];

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
