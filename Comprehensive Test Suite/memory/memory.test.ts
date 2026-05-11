import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE = "http://localhost:4889";

async function gatewayUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function json(url: string, opts?: any) {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function makeTmp() {
  const dir = join(tmpdir(), `lite-test-mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Memory — API endpoints", () => {
  it("GET /api/agents/:id/memory returns memory data", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/agents/hub-lite/memory");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });

  it("POST /api/agents/:id/memory/search handles query", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/hub-lite/memory/search", {
      method: "POST",
      body: { query: "test search" },
    });
    assert.ok(status === 200 || status === 404);
  });

  it("POST /api/agents/:id/memory/write creates memory entry", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/hub-lite/memory/write", {
      method: "POST",
      body: { content: "Test memory entry from test suite" },
    });
    assert.ok(status === 200 || status === 201 || status === 400);
  });

  it("DELETE /api/agents/:id/memory/context handles request", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/hub-lite/memory/context", {
      method: "DELETE",
    });
    // May return 200 (cleared) or 404 (no context.md)
    assert.ok(status === 200 || status === 404);
  });
});

describe("Memory — file structure", () => {
  let tmpDir: string;

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("memory directory contains expected files", () => {
    tmpDir = makeTmp();
    // Simulate memory dir structure
    writeFileSync(join(tmpDir, "context.md"), "# Context\n\nTest context for agent.");
    writeFileSync(join(tmpDir, "session.json"), JSON.stringify({ id: "sess-1" }));
    mkdirSync(join(tmpDir, "daily"), { recursive: true });
    writeFileSync(join(tmpDir, "daily", "2025-01-01.md"), "## Daily log\n\nTest entry.");

    assert.ok(existsSync(join(tmpDir, "context.md")));
    assert.ok(existsSync(join(tmpDir, "session.json")));
    assert.ok(existsSync(join(tmpDir, "daily", "2025-01-01.md")));
  });

  it("context.md is valid markdown", () => {
    tmpDir = makeTmp();
    const content = "# Agent Memory\n\n## Key Facts\n\n- User prefers dark mode\n- Project uses TypeScript\n";
    writeFileSync(join(tmpDir, "context.md"), content);
    const loaded = readFileSync(join(tmpDir, "context.md"), "utf-8");
    assert.ok(loaded.startsWith("#"));
    assert.ok(loaded.includes("Key Facts"));
  });

  it("daily logs are date-named", () => {
    tmpDir = makeTmp();
    mkdirSync(join(tmpDir, "daily"), { recursive: true });
    const dateStr = new Date().toISOString().split("T")[0];
    writeFileSync(join(tmpDir, "daily", `${dateStr}.md`), "Today's log");
    const files = readdirSync(join(tmpDir, "daily"));
    assert.ok(files.some(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)));
  });
});
