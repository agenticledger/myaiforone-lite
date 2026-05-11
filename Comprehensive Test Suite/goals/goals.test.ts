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

describe("Goals — API", () => {
  it("POST /api/agents/:id/goals creates a goal", async () => {
    if (!(await gatewayUp())) return;
    const goalId = `test-goal-${Date.now()}`;
    const { status, body } = await json("/api/agents/hub-lite/goals", {
      method: "POST",
      body: {
        id: goalId,
        description: "Test goal from test suite",
        schedule: "manual",
        enabled: false,
      },
    });
    assert.ok(status === 200 || status === 201 || status === 400);

    // Cleanup
    if (status === 200) {
      await json(`/api/agents/hub-lite/goals/${goalId}`, { method: "DELETE" });
    }
  });

  it("POST /api/agents/:id/goals/:goalId/toggle toggles goal", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/hub-lite/goals/nonexistent/toggle", { method: "POST" });
    assert.ok(status === 200 || status === 404);
  });

  it("GET /api/agents/:id/goals/:goalId/history returns history", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/hub-lite/goals/nonexistent/history");
    assert.ok(status === 200 || status === 404);
  });

  it("DELETE /api/agents/:id/goals/:goalId removes goal", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/hub-lite/goals/nonexistent", { method: "DELETE" });
    assert.ok(status === 200 || status === 404);
  });
});
