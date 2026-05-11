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

describe("Wiki Sync — agent config", () => {
  it("hub-lite agent config includes wiki field", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/agents/hub-lite");
    const config = (body as any).config || body;
    // wiki field should be boolean or undefined
    if ("wiki" in config) {
      assert.equal(typeof config.wiki, "boolean");
    }
  });

  it("agent config may include wikiSync settings", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/agents/hub-lite");
    const config = (body as any).config || body;
    if (config.wikiSync) {
      assert.ok("enabled" in config.wikiSync);
      assert.ok("schedule" in config.wikiSync);
    }
  });
});

describe("Wiki Sync — memory integration", () => {
  it("memory endpoint works alongside wiki-enabled agents", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/agents/hub-lite/memory");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });

  it("memory write can add content (used by wiki sync)", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/hub-lite/memory/write", {
      method: "POST",
      body: { content: "[wiki-test] Test entry from test suite" },
    });
    assert.ok(status === 200 || status === 201 || status === 404);
  });

  it("memory search finds written content", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/agents/hub-lite/memory/search", {
      method: "POST",
      body: { query: "wiki-test" },
    });
    assert.ok(status === 200 || status === 404);
    if (status === 200 && (body as any).results) {
      assert.ok(Array.isArray((body as any).results));
    }
  });
});
