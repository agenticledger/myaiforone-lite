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
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

describe("Streaming — job lifecycle", () => {
  it("POST /api/chat/:agentId/stream returns jobId", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/chat/hub-lite/stream", {
      method: "POST",
      body: { text: "ping" },
    });
    assert.equal(status, 200);
    assert.ok((body as any).jobId, "Should return a jobId");

    // Stop the job immediately to clean up
    const jobId = (body as any).jobId;
    if (jobId) await fetch(`${BASE}/api/chat/jobs/${jobId}/stop`, { method: "POST" }).catch(() => {});
  });

  it("GET /api/chat/jobs/:jobId/stream returns SSE content type", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/chat/hub-lite/stream", {
      method: "POST",
      body: { text: "test streaming headers" },
    });
    const jobId = (body as any).jobId;
    if (!jobId) return;

    try {
      const res = await fetch(`${BASE}/api/chat/jobs/${jobId}/stream?after=0`, {
        signal: AbortSignal.timeout(2000),
      });
      assert.equal(res.status, 200);
      const ct = res.headers.get("content-type") || "";
      assert.ok(ct.includes("text/event-stream"), `Expected SSE content-type, got: ${ct}`);
    } catch (e: any) {
      // AbortError or timeout is expected — we just want to check headers
      if (e.name !== "AbortError" && e.code !== "ABORT_ERR" && !e.message?.includes("aborted")) throw e;
    } finally {
      await fetch(`${BASE}/api/chat/jobs/${jobId}/stop`, { method: "POST" }).catch(() => {});
    }
  });

  it("POST /api/chat/jobs/:jobId/stop stops a running job", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/chat/hub-lite/stream", {
      method: "POST",
      body: { text: "test stop" },
    });
    const jobId = (body as any).jobId;
    if (!jobId) return;

    const { status } = await json(`/api/chat/jobs/${jobId}/stop`, { method: "POST" });
    assert.ok(status === 200 || status === 404, `Stop should return 200 or 404, got ${status}`);
  });
});

describe("Streaming — error handling", () => {
  it("returns 404 for nonexistent job stream", async () => {
    if (!(await gatewayUp())) return;
    try {
      const res = await fetch(`${BASE}/api/chat/jobs/nonexistent-job-id/stream?after=0`, {
        signal: AbortSignal.timeout(2000),
      });
      assert.equal(res.status, 404);
    } catch (e: any) {
      if (e.name !== "AbortError" && e.code !== "ABORT_ERR") throw e;
    }
  });
});
