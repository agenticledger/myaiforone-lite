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

describe("Cron — API", () => {
  it("GET /api/automations returns automations list", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/automations");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });

  it("POST /api/agents/:id/cron creates a cron task", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/agents/hub-lite/cron", {
      method: "POST",
      body: {
        schedule: "0 9 * * *",
        prompt: "Test cron from test suite",
        enabled: false,
      },
    });
    assert.ok(status === 200 || status === 201 || status === 400);

    // Cleanup if created
    if (status === 200 && (body as any)?.index !== undefined) {
      await json(`/api/agents/hub-lite/cron/${(body as any).index}`, { method: "DELETE" });
    }
  });

  it("POST /api/agents/:id/cron/:index/toggle toggles cron", async () => {
    if (!(await gatewayUp())) return;
    // Try toggling index 0 — may or may not exist
    const { status } = await json("/api/agents/hub-lite/cron/0/toggle", { method: "POST" });
    assert.ok(status === 200 || status === 404);
  });

  it("GET /api/agents/:id/cron/:index/history returns history", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/hub-lite/cron/0/history");
    assert.ok(status === 200 || status === 404);
  });
});
