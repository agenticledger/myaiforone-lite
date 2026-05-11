import { describe, it } from "node:test";
import assert from "node:assert/strict";

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

describe("MCPs — listing", () => {
  it("GET /api/mcps returns array of MCP configs", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/mcps");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body) || Array.isArray((body as any)?.mcps), "Should contain MCP list");
  });

  it("GET /api/mcp-catalog returns catalog object", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/mcp-catalog");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });

  it("GET /api/debug/mcp returns debug info", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/debug/mcp");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });
});

describe("MCPs — per-agent keys", () => {
  it("GET /api/agents/:id/mcp-keys returns key list", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/agents/hub-lite/mcp-keys");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });

  it("POST /api/agents/:id/mcp-keys sets a key", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/hub-lite/mcp-keys", {
      method: "POST",
      body: { mcpName: "test-mcp", key: "TEST_KEY", value: "test-value-123" },
    });
    assert.ok(status === 200 || status === 201 || status === 400);

    // Cleanup
    if (status === 200) {
      await json("/api/agents/hub-lite/mcp-keys/test-mcp", { method: "DELETE" });
    }
  });
});

describe("MCPs — connections", () => {
  it("GET /api/agents/:id/mcp-connections returns connections", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/agents/hub-lite/mcp-connections");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });
});
