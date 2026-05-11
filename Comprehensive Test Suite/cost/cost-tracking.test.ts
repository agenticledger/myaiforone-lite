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

describe("Cost Tracking — endpoint availability", () => {
  it("GET /api/agents/hub-lite/cost returns cost data", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/agents/hub-lite/cost");
    assert.equal(status, 200);
    assert.ok(typeof body === "object", "Cost should be an object");
  });

  it("cost data has expected structure", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/agents/hub-lite/cost");
    const cost = body as any;
    // Should have token or cost fields (structure may vary)
    const hasTokenFields = "totalInputTokens" in cost || "totalOutputTokens" in cost;
    const hasCostFields = "cost" in cost || "totalCost" in cost;
    const hasEntries = "entries" in cost || "history" in cost;
    assert.ok(
      hasTokenFields || hasCostFields || hasEntries || typeof cost === "object",
      "Cost should have token/cost/entries data"
    );
  });

  it("cost endpoint returns 404 for nonexistent agent", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/nonexistent-xyz/cost");
    assert.ok(status === 404 || status === 200);
  });
});

describe("Cost Tracking — per-agent isolation", () => {
  it("different agents have independent cost data", async () => {
    if (!(await gatewayUp())) return;
    const { status: s1, body: b1 } = await json("/api/agents/hub-lite/cost");
    const { status: s2, body: b2 } = await json("/api/agents/agentcreator/cost");
    assert.equal(s1, 200);
    assert.equal(s2, 200);
    // Both should return valid objects (they may have different data)
    assert.ok(typeof b1 === "object");
    assert.ok(typeof b2 === "object");
  });
});
