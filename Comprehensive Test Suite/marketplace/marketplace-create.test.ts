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

// ─── Skill Creation ───────────────────────────────────────────────

describe("Marketplace — create skill", () => {
  const SKILL_ID = `test-skill-${Date.now()}`;

  after(async () => {
    // Cleanup: remove from skills list if present
    // (No delete endpoint, but the skill won't interfere)
  });

  it("POST /api/skills/create requires id, name, content", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/skills/create", {
      method: "POST",
      body: {},
    });
    assert.equal(status, 400);
  });

  it("POST /api/skills/create rejects missing content", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/skills/create", {
      method: "POST",
      body: { id: "test", name: "Test" },
    });
    assert.equal(status, 400);
  });

  it("POST /api/skills/create creates a skill", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/skills/create", {
      method: "POST",
      body: {
        id: SKILL_ID,
        name: "Test Skill",
        description: "A test skill for automated testing",
        content: "When invoked, respond with 'test passed'.",
      },
    });
    assert.equal(status, 200);
    assert.equal((body as any).ok, true);
    assert.equal((body as any).id, SKILL_ID);
    assert.ok((body as any).path, "Should return file path");
  });

  it("created skill appears in marketplace skills list", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/marketplace/skills?source=personal");
    assert.equal(status, 200);
    const items = (body as any).items || [];
    const found = items.find((s: any) => s.id === SKILL_ID);
    assert.ok(found, `Skill ${SKILL_ID} should appear in personal skills`);
    assert.equal(found.source, "local");
  });

  it("creating a skill with same id replaces previous entry", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/skills/create", {
      method: "POST",
      body: {
        id: SKILL_ID,
        name: "Test Skill Updated",
        content: "Updated content.",
      },
    });
    assert.equal(status, 200);
    assert.equal((body as any).ok, true);

    // Verify no duplicates
    const { body: listBody } = await json("/api/marketplace/skills?source=personal");
    const items = (listBody as any).items || [];
    const matches = items.filter((s: any) => s.id === SKILL_ID);
    assert.equal(matches.length, 1, "Should not have duplicate entries");
    assert.equal(matches[0].name, "Test Skill Updated");
  });
});

// ─── Prompt Creation ──────────────────────────────────────────────

describe("Marketplace — create prompt", () => {
  const PROMPT_ID = `test-prompt-${Date.now()}`;

  it("POST /api/marketplace/create-prompt requires id, name, content", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/marketplace/create-prompt", {
      method: "POST",
      body: {},
    });
    assert.equal(status, 400);
  });

  it("POST /api/marketplace/create-prompt rejects missing name", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/marketplace/create-prompt", {
      method: "POST",
      body: { id: "test", content: "test content" },
    });
    assert.equal(status, 400);
  });

  it("POST /api/marketplace/create-prompt creates a prompt", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/marketplace/create-prompt", {
      method: "POST",
      body: {
        id: PROMPT_ID,
        name: "Test Prompt",
        content: "---\nname: test-prompt\ndescription: A test prompt\n---\n\nWhen invoked, respond with 'prompt test passed'.",
      },
    });
    assert.equal(status, 200);
    assert.equal((body as any).ok, true);
    assert.equal((body as any).id, PROMPT_ID);
    assert.ok((body as any).path, "Should return file path");
  });

  it("created prompt appears in marketplace prompts list", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/marketplace/prompts?source=personal");
    const items = (body as any).items || [];
    const found = items.find((p: any) => p.id === PROMPT_ID);
    assert.ok(found, `Prompt ${PROMPT_ID} should appear in personal prompts`);
    assert.equal(found.source, "local");
  });

  it("creating a prompt with same id replaces previous entry", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/marketplace/create-prompt", {
      method: "POST",
      body: {
        id: PROMPT_ID,
        name: "Test Prompt Updated",
        content: "Updated prompt content.",
      },
    });
    assert.equal(status, 200);

    const { body: listBody } = await json("/api/marketplace/prompts?source=personal");
    const items = (listBody as any).items || [];
    const matches = items.filter((p: any) => p.id === PROMPT_ID);
    assert.equal(matches.length, 1, "Should not have duplicate entries");
    assert.equal(matches[0].name, "Test Prompt Updated");
  });
});

// ─── App Creation ─────────────────────────────────────────────────

describe("Marketplace — create app", () => {
  const APP_ID = `test-app-${Date.now()}`;

  it("POST /api/apps requires id and name", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/apps", {
      method: "POST",
      body: {},
    });
    assert.equal(status, 400);
  });

  it("POST /api/apps rejects missing name", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/apps", {
      method: "POST",
      body: { id: "test" },
    });
    assert.equal(status, 400);
  });

  it("POST /api/apps creates an app", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/apps", {
      method: "POST",
      body: {
        id: APP_ID,
        name: "Test App",
        description: "A test app for automated testing",
        url: "http://localhost:3000",
      },
    });
    assert.equal(status, 200);
    assert.equal((body as any).ok, true);
    assert.equal((body as any).id, APP_ID);
  });

  it("created app appears in marketplace apps list", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/marketplace/apps");
    const items = (body as any).items || [];
    const found = items.find((a: any) => a.id === APP_ID);
    assert.ok(found, `App ${APP_ID} should appear in apps list`);
    assert.equal(found.source, "local");
  });

  it("creating an app with same id replaces previous entry", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/apps", {
      method: "POST",
      body: {
        id: APP_ID,
        name: "Test App Updated",
        description: "Updated description",
      },
    });
    assert.equal(status, 200);

    const { body: listBody } = await json("/api/marketplace/apps");
    const items = (listBody as any).items || [];
    const matches = items.filter((a: any) => a.id === APP_ID);
    assert.equal(matches.length, 1, "Should not have duplicate entries");
    assert.equal(matches[0].name, "Test App Updated");
  });
});
