import { describe, it, after } from "node:test";
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

const jobIds: string[] = [];

after(async () => {
  // Stop all jobs created during tests
  for (const jobId of jobIds) {
    await fetch(`${BASE}/api/chat/jobs/${jobId}/stop`, { method: "POST" }).catch(() => {});
  }
});

describe("Concurrent Streams — multiple jobs", () => {
  it("starts 3 jobs simultaneously and gets unique jobIds", async () => {
    if (!(await gatewayUp())) return;
    const promises = [
      json("/api/chat/hub-lite/stream", { method: "POST", body: { text: "concurrent test 1" } }),
      json("/api/chat/hub-lite/stream", { method: "POST", body: { text: "concurrent test 2" } }),
      json("/api/chat/hub-lite/stream", { method: "POST", body: { text: "concurrent test 3" } }),
    ];

    const results = await Promise.all(promises);

    for (const r of results) {
      assert.equal(r.status, 200);
      assert.ok((r.body as any).jobId, "Each should return a jobId");
      jobIds.push((r.body as any).jobId);
    }

    // All jobIds should be unique
    const unique = new Set(jobIds);
    assert.equal(unique.size, jobIds.length, "All jobIds should be unique");
  });

  it("can stop all concurrent jobs", async () => {
    if (!(await gatewayUp())) return;
    const stopPromises = jobIds.map(jobId =>
      json(`/api/chat/jobs/${jobId}/stop`, { method: "POST" })
    );
    const results = await Promise.all(stopPromises);

    for (const r of results) {
      assert.ok(r.status === 200 || r.status === 404, `Stop should return 200/404, got ${r.status}`);
    }
  });
});

describe("Concurrent Streams — cross-agent", () => {
  it("starts jobs on different agents simultaneously", async () => {
    if (!(await gatewayUp())) return;
    const agents = ["hub-lite", "agentcreator", "skillcreator"];
    const promises = agents.map(agentId =>
      json(`/api/chat/${agentId}/stream`, { method: "POST", body: { text: "cross-agent test" } })
    );

    const results = await Promise.all(promises);
    const newJobIds: string[] = [];

    for (let i = 0; i < results.length; i++) {
      assert.equal(results[i].status, 200, `Job for ${agents[i]} should start`);
      const jobId = (results[i].body as any).jobId;
      assert.ok(jobId);
      newJobIds.push(jobId);
    }

    // Unique jobIds
    const unique = new Set(newJobIds);
    assert.equal(unique.size, newJobIds.length);

    // Cleanup
    for (const jobId of newJobIds) {
      await fetch(`${BASE}/api/chat/jobs/${jobId}/stop`, { method: "POST" }).catch(() => {});
    }
  });
});

describe("Concurrent Streams — SSE connection", () => {
  it("SSE stream returns valid content-type for concurrent job", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/chat/hub-lite/stream", {
      method: "POST",
      body: { text: "sse test" },
    });
    const jobId = (body as any).jobId;
    if (!jobId) return;

    try {
      const res = await fetch(`${BASE}/api/chat/jobs/${jobId}/stream?after=0`, {
        signal: AbortSignal.timeout(2000),
      });
      assert.equal(res.status, 200);
      const ct = res.headers.get("content-type") || "";
      assert.ok(ct.includes("text/event-stream"), `Expected SSE, got: ${ct}`);
    } catch (e: any) {
      if (e.name !== "AbortError" && e.code !== "ABORT_ERR" && !e.message?.includes("aborted")) throw e;
    } finally {
      await fetch(`${BASE}/api/chat/jobs/${jobId}/stop`, { method: "POST" }).catch(() => {});
    }
  });
});
