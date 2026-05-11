import { describe, it, before, after } from "node:test";
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

const AGENT_ID = `mkt-assign-${Date.now()}`;

before(async () => {
  if (!(await gatewayUp())) return;
  await json("/api/agents", {
    method: "POST",
    body: { agentId: AGENT_ID, name: "Marketplace Test", alias: AGENT_ID },
  });
});

after(async () => {
  await json(`/api/agents/${AGENT_ID}`, {
    method: "DELETE",
    body: { confirmAlias: `@${AGENT_ID}` },
  }).catch(() => {});
});

describe("Marketplace — assign/unassign", () => {
  it("POST /api/marketplace/assign requires type, id, and agentIds", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/marketplace/assign", {
      method: "POST",
      body: {},
    });
    assert.equal(status, 400);
  });

  it("POST /api/marketplace/assign rejects empty agentIds array", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/marketplace/assign", {
      method: "POST",
      body: { type: "skill", id: "test-skill", agentIds: [] },
    });
    assert.equal(status, 400);
  });

  it("POST /api/marketplace/assign assigns a skill to agent", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/marketplace/assign", {
      method: "POST",
      body: { type: "skill", id: "test-skill-assign", agentIds: [AGENT_ID] },
    });
    assert.ok(status === 200 || status === 201, `Expected 200/201, got ${status}`);

    // Verify assignment
    const { body: agentBody } = await json(`/api/agents/${AGENT_ID}`);
    const config = (agentBody as any).config || agentBody;
    const skills = config.skills || [];
    assert.ok(skills.includes("test-skill-assign"), "Skill should be assigned to agent");
  });

  it("POST /api/marketplace/assign assigns a prompt to agent", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/marketplace/assign", {
      method: "POST",
      body: { type: "prompt", id: "test-prompt-assign", agentIds: [AGENT_ID] },
    });
    assert.ok(status === 200 || status === 201, `Expected 200/201, got ${status}`);
  });

  it("POST /api/marketplace/assign assigns an MCP to agent", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/marketplace/assign", {
      method: "POST",
      body: { type: "mcp", id: "test-mcp-assign", agentIds: [AGENT_ID] },
    });
    assert.ok(status === 200 || status === 201, `Expected 200/201, got ${status}`);
  });

  it("GET /api/marketplace/skills lists available skills", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/marketplace/skills");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).items));
  });

  it("GET /api/marketplace/skills?source=personal filters personal skills", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/marketplace/skills?source=personal");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).items));
  });

  it("GET /api/marketplace/prompts lists available prompts", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/marketplace/prompts");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).items));
  });

  it("GET /api/marketplace/mcps lists available MCPs", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/marketplace/mcps");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).items));
  });

  it("rejects invalid marketplace type", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/marketplace/invalid-type");
    assert.equal(status, 400);
  });
});
