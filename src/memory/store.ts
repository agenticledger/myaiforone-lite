/**
 * Vector store — JSON default, auto-upgrades to SQLite if better-sqlite3 is available.
 * Stores text chunks with their embedding vectors for semantic search.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { log } from "../logger.js";

export interface MemoryChunk {
  id: string;
  text: string;
  vector: number[];
  source: string;       // "daily", "context", "conversation", "manual"
  timestamp: string;    // ISO date
  metadata?: Record<string, string>;
}

export interface VectorStore {
  name: string;
  add(chunk: MemoryChunk): Promise<void>;
  addBatch(chunks: MemoryChunk[]): Promise<void>;
  getAll(): Promise<MemoryChunk[]>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
}

// ─── JSON Store (default) ────────────────────────────────────────────

class JSONStore implements VectorStore {
  name = "json";
  private filePath: string;
  private chunks: MemoryChunk[] = [];
  private loaded = false;

  constructor(memoryDir: string) {
    mkdirSync(memoryDir, { recursive: true });
    this.filePath = join(memoryDir, "vectors.json");
  }

  private load(): void {
    if (this.loaded) return;
    if (existsSync(this.filePath)) {
      try {
        this.chunks = JSON.parse(readFileSync(this.filePath, "utf-8"));
      } catch {
        this.chunks = [];
      }
    }
    this.loaded = true;
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.chunks));
  }

  async add(chunk: MemoryChunk): Promise<void> {
    this.load();
    // Replace if same ID exists
    this.chunks = this.chunks.filter(c => c.id !== chunk.id);
    this.chunks.push(chunk);
    this.save();
  }

  async addBatch(chunks: MemoryChunk[]): Promise<void> {
    this.load();
    const newIds = new Set(chunks.map(c => c.id));
    this.chunks = this.chunks.filter(c => !newIds.has(c.id));
    this.chunks.push(...chunks);
    this.save();
  }

  async getAll(): Promise<MemoryChunk[]> {
    this.load();
    return [...this.chunks];
  }

  async remove(id: string): Promise<void> {
    this.load();
    this.chunks = this.chunks.filter(c => c.id !== id);
    this.save();
  }

  async clear(): Promise<void> {
    this.chunks = [];
    this.loaded = true;
    this.save();
  }

  async count(): Promise<number> {
    this.load();
    return this.chunks.length;
  }
}

// ─── SQLite Store (auto-upgrade if available) ────────────────────────

async function trySQLiteStore(memoryDir: string): Promise<VectorStore | null> {
  try {
    // Dynamic import — only works if better-sqlite3 is installed
    // Use createRequire to avoid TypeScript module resolution errors
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");

    const dbPath = join(memoryDir, "vectors.sqlite");
    const db = new Database(dbPath);

    // Create table
    db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        vector TEXT NOT NULL,
        source TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        metadata TEXT
      )
    `);

    const store: VectorStore = {
      name: "sqlite",

      async add(chunk: MemoryChunk) {
        db.prepare(`
          INSERT OR REPLACE INTO chunks (id, text, vector, source, timestamp, metadata)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          chunk.id, chunk.text, JSON.stringify(chunk.vector),
          chunk.source, chunk.timestamp, chunk.metadata ? JSON.stringify(chunk.metadata) : null
        );
      },

      async addBatch(chunks: MemoryChunk[]) {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO chunks (id, text, vector, source, timestamp, metadata)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const tx = db.transaction((items: MemoryChunk[]) => {
          for (const c of items) {
            stmt.run(c.id, c.text, JSON.stringify(c.vector), c.source, c.timestamp,
              c.metadata ? JSON.stringify(c.metadata) : null);
          }
        });
        tx(chunks);
      },

      async getAll(): Promise<MemoryChunk[]> {
        const rows = db.prepare("SELECT * FROM chunks").all() as any[];
        return rows.map(r => ({
          id: r.id, text: r.text, vector: JSON.parse(r.vector),
          source: r.source, timestamp: r.timestamp,
          metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
        }));
      },

      async remove(id: string) {
        db.prepare("DELETE FROM chunks WHERE id = ?").run(id);
      },

      async clear() {
        db.exec("DELETE FROM chunks");
      },

      async count(): Promise<number> {
        const row = db.prepare("SELECT COUNT(*) as cnt FROM chunks").get() as any;
        return row.cnt;
      },
    };

    log.info("Memory store: SQLite (better-sqlite3)");
    return store;
  } catch {
    return null;
  }
}

// ─── Store factory ───────────────────────────────────────────────────

export async function createStore(memoryDir: string): Promise<VectorStore> {
  // Try SQLite first
  const sqlite = await trySQLiteStore(memoryDir);
  if (sqlite) return sqlite;

  // Fall back to JSON
  log.info("Memory store: JSON (install better-sqlite3 for faster search at scale)");
  return new JSONStore(memoryDir);
}
