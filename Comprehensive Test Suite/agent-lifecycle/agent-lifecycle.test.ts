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

const AGENT_ID = `e2e-lifecycle-${Date.now()}`;
let jobId: string | null = null;

after(async () => {
  // Cleanup: stop any running jobs and delete the test agent
  if (jobId) {
    await fetch(`${BASE}/api/chat/jobs/${jobId}/stop`, { method: "POST" }).catch(() => {});
  }
  await json(`/api/agents/${AGENT_ID}`, {
    method: "DELETE",
    body: { confirmAlias: `@${AGENT_ID}` },
  }).catch(() => {});
});

describe("Agent Lifecycle — end-to-end", () => {
  it("Step 1: create agent", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/agents", {
      method: "POST",
      body: {
        agentId: AGENT_ID,
        name: "E2E Lifecycle Agent",
        alias: AGENT_ID,
        description: "Created by e2e lifecycle test",
        systemPrompt: "You are a test agent. Reply with exactly: PONG",
      },
    });
    assert.equal(status, 200, `Create failed: ${JSON.stringify(body)}`);
    assert.equal((body as any).ok, true);
  });

  it("Step 2: agent appears in list", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/agents");
    const ids = ((body as any).agents || []).map((a: any) => a.id);
    assert.ok(ids.includes(AGENT_ID), "Agent should appear in list after creation");
  });

  it("Step 3: agent has correct details", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${AGENT_ID}`);
    assert.equal(status, 200);
    assert.equal((body as any).id, AGENT_ID);
    const name = (body as any).config?.name || (body as any).name;
    assert.equal(name, "E2E Lifecycle Agent");
  });

  it("Step 4: agent appears on dashboard", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/dashboard");
    const agents = (body as any).agents || [];
    const found = agents.find((a: any) => a.id === AGENT_ID);
    assert.ok(found, `Agent ${AGENT_ID} should appear on dashboard`);
    assert.ok(found.name, "Agent should have a name");
  });

  it("Step 5: start streaming chat", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/chat/${AGENT_ID}/stream`, {
      method: "POST",
      body: { text: "ping" },
    });
    assert.equal(status, 200);
    assert.ok((body as any).jobId, "Should return a jobId");
    jobId = (body as any).jobId;
  });

  it("Step 6: session tab was created", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${AGENT_ID}/session-tabs`);
    assert.equal(status, 200);
    // Tabs array should exist (may be empty if no explicit tab was created)
    assert.ok(Array.isArray((body as any).tabs));
  });

  it("Step 7: memory endpoint is accessible", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${AGENT_ID}/memory`);
    assert.equal(status, 200);
  });

  it("Step 8: cost endpoint is accessible", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${AGENT_ID}/cost`);
    assert.equal(status, 200);
  });

  it("Step 9: logs endpoint is accessible", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${AGENT_ID}/logs`);
    assert.equal(status, 200);
  });

  it("Step 10: update agent name", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${AGENT_ID}`, {
      method: "PUT",
      body: { name: "Updated E2E Agent", alias: AGENT_ID },
    });
    assert.equal(status, 200);

    // Verify update
    const { body } = await json(`/api/agents/${AGENT_ID}`);
    const name = (body as any).config?.name || (body as any).name;
    assert.equal(name, "Updated E2E Agent");
  });

  it("Step 11: delete agent with confirmation", async () => {
    if (!(await gatewayUp())) return;
    // First attempt without confirmation should fail
    const { status: failStatus } = await json(`/api/agents/${AGENT_ID}`, {
      method: "DELETE",
      body: {},
    });
    assert.ok(failStatus === 400 || failStatus === 422 || failStatus === 500, "Delete without confirm should fail");

    // Now delete with proper confirmation
    const { status, body } = await json(`/api/agents/${AGENT_ID}`, {
      method: "DELETE",
      body: { confirmAlias: `@${AGENT_ID}` },
    });
    assert.equal(status, 200);
    assert.equal((body as any).ok, true);
  });

  it("Step 12: agent is gone after deletion", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${AGENT_ID}`);
    assert.equal(status, 404);
  });
});
