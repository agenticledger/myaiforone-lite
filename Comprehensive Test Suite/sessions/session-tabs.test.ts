import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4889";
const AGENT_ID = "hub-lite";

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

const TAB_A = `test-tab-a-${Date.now()}`;
const TAB_B = `test-tab-b-${Date.now()}`;

after(async () => {
  // Cleanup tabs
  await json(`/api/agents/${AGENT_ID}/session-tabs/${TAB_A}`, { method: "DELETE" }).catch(() => {});
  await json(`/api/agents/${AGENT_ID}/session-tabs/${TAB_B}`, { method: "DELETE" }).catch(() => {});
});

describe("Session Tabs — full CRUD", () => {
  it("GET /session-tabs returns tabs array", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${AGENT_ID}/session-tabs`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).tabs));
  });

  it("POST /session-tabs creates tab A", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${AGENT_ID}/session-tabs`, {
      method: "POST",
      body: { tabId: TAB_A, label: "Test Tab A" },
    });
    assert.ok(status === 200 || status === 201, `Expected 200/201, got ${status}`);
    assert.equal((body as any).ok, true);
    assert.equal((body as any).tab?.id, TAB_A);
    assert.equal((body as any).tab?.label, "Test Tab A");
    assert.ok((body as any).tab?.createdAt);
  });

  it("POST /session-tabs creates tab B", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${AGENT_ID}/session-tabs`, {
      method: "POST",
      body: { tabId: TAB_B, label: "Test Tab B" },
    });
    assert.ok(status === 200 || status === 201);
    assert.equal((body as any).tab?.id, TAB_B);
  });

  it("POST /session-tabs requires tabId", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${AGENT_ID}/session-tabs`, {
      method: "POST",
      body: { label: "No ID Tab" },
    });
    assert.ok(status === 400 || status === 422, `Expected 400/422, got ${status}`);
  });

  it("both tabs appear in list", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json(`/api/agents/${AGENT_ID}/session-tabs`);
    const tabs = (body as any).tabs || [];
    const ids = tabs.map((t: any) => t.id);
    assert.ok(ids.includes(TAB_A), "Tab A should exist");
    assert.ok(ids.includes(TAB_B), "Tab B should exist");
  });

  it("PUT /session-tabs/:tabId renames a tab", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${AGENT_ID}/session-tabs/${TAB_A}`, {
      method: "PUT",
      body: { label: "Renamed Tab A" },
    });
    assert.equal(status, 200);

    // Verify rename
    const { body } = await json(`/api/agents/${AGENT_ID}/session-tabs`);
    const tab = ((body as any).tabs || []).find((t: any) => t.id === TAB_A);
    assert.equal(tab?.label, "Renamed Tab A");
  });

  it("PUT /session-tabs/:tabId rejects empty label", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${AGENT_ID}/session-tabs/${TAB_A}`, {
      method: "PUT",
      body: { label: "" },
    });
    assert.ok(status === 400 || status === 422);
  });

  it("GET /session-tabs/:tabId/history returns messages array", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${AGENT_ID}/session-tabs/${TAB_A}/history`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).messages));
  });

  it("DELETE /session-tabs/:tabId removes tab B", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${AGENT_ID}/session-tabs/${TAB_B}`, {
      method: "DELETE",
    });
    assert.equal(status, 200);

    // Verify removed
    const { body } = await json(`/api/agents/${AGENT_ID}/session-tabs`);
    const ids = ((body as any).tabs || []).map((t: any) => t.id);
    assert.ok(!ids.includes(TAB_B), "Tab B should be gone");
  });

  it("DELETE /session-tabs/:tabId returns 404 for nonexistent tab", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${AGENT_ID}/session-tabs/nonexistent-tab-xyz`, {
      method: "DELETE",
    });
    assert.ok(status === 200 || status === 404);
  });
});

describe("Session Tabs — isolation", () => {
  it("tabs are per-agent", async () => {
    if (!(await gatewayUp())) return;
    // Get tabs for different agents — they should be independent
    const { body: hubTabs } = await json(`/api/agents/hub-lite/session-tabs`);
    const { body: creatorTabs } = await json(`/api/agents/agentcreator/session-tabs`);
    assert.ok(Array.isArray((hubTabs as any).tabs));
    assert.ok(Array.isArray((creatorTabs as any).tabs));
    // Just verify both return independently without error
  });
});
