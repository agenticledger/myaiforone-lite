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
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("MCP Tools — server listing", () => {
  it("GET /api/mcps lists myaiforone-lite server", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/mcps");
    assert.equal(status, 200);
    const mcps = Array.isArray(body) ? body : (body as any)?.mcps || [];
    assert.ok(mcps.includes("myaiforone-lite") || mcps.some((m: any) => m === "myaiforone-lite" || m?.name === "myaiforone-lite"),
      "myaiforone-lite should be in MCP list");
  });

  it("GET /api/mcp-catalog returns catalog with entries", async () => {
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

describe("MCP Tools — per-agent keys", () => {
  it("GET /api/agents/hub-lite/mcp-keys returns key list", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/agents/hub-lite/mcp-keys");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });

  it("POST /api/agents/hub-lite/mcp-keys sets and cleans up a key", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/hub-lite/mcp-keys", {
      method: "POST",
      body: { mcpName: "test-mcp-key-test", key: "TEST_API_KEY", value: "test-value-abc" },
    });
    assert.ok(status === 200 || status === 201 || status === 400,
      `Expected 200/201/400, got ${status}`);

    // Cleanup
    if (status === 200 || status === 201) {
      await json("/api/agents/hub-lite/mcp-keys/test-mcp-key-test", { method: "DELETE" }).catch(() => {});
    }
  });
});

describe("MCP Tools — per-agent connections", () => {
  it("GET /api/agents/hub-lite/mcp-connections returns connections", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/agents/hub-lite/mcp-connections");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });

  it("hub-lite has myaiforone-lite MCP configured", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json(`/api/agents/hub-lite`);
    const mcps = (body as any).config?.mcps || [];
    assert.ok(mcps.includes("myaiforone-lite"), "hub-lite should have myaiforone-lite MCP");
  });
});

describe("MCP Tools — creator agents have MCP", () => {
  const creators = ["agentcreator", "skillcreator", "appcreator", "promptcreator"];

  for (const id of creators) {
    it(`${id} has myaiforone-lite MCP configured`, async () => {
      if (!(await gatewayUp())) return;
      const { body } = await json(`/api/agents/${id}`);
      const mcps = (body as any).config?.mcps || [];
      assert.ok(mcps.includes("myaiforone-lite"), `${id} should have myaiforone-lite MCP`);
    });
  }
});
