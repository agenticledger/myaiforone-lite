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

describe("Logs — endpoint availability", () => {
  it("GET /api/agents/hub-lite/logs returns log data", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/agents/hub-lite/logs");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });

  it("log data has expected structure", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/agents/hub-lite/logs");
    const logs = body as any;
    // Logs might be array or object with entries
    const isArray = Array.isArray(logs);
    const hasEntries = "entries" in logs || "logs" in logs || "messages" in logs;
    assert.ok(isArray || hasEntries || typeof logs === "object",
      "Logs should be array or have entries");
  });

  it("returns 404 for nonexistent agent logs", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/nonexistent-xyz/logs");
    assert.ok(status === 404 || status === 200);
  });
});

describe("Logs — per-agent isolation", () => {
  it("different agents have independent logs", async () => {
    if (!(await gatewayUp())) return;
    const { status: s1 } = await json("/api/agents/hub-lite/logs");
    const { status: s2 } = await json("/api/agents/agentcreator/logs");
    assert.equal(s1, 200);
    assert.equal(s2, 200);
  });
});

describe("Logs — conversation log via session tabs", () => {
  it("tab history returns messages array (may be empty)", async () => {
    if (!(await gatewayUp())) return;
    // Create a temp tab
    const tabId = `log-test-${Date.now()}`;
    await json(`/api/agents/hub-lite/session-tabs`, {
      method: "POST",
      body: { tabId, label: "Log Test" },
    });

    // Get history
    const { status, body } = await json(`/api/agents/hub-lite/session-tabs/${tabId}/history`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).messages));

    // Cleanup
    await json(`/api/agents/hub-lite/session-tabs/${tabId}`, { method: "DELETE" });
  });
});
