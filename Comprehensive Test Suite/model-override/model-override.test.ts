import { describe, it, after } from "node:test";
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

after(async () => {
  // Always clean up model override
  await json(`/api/agents/${AGENT_ID}/model`, { method: "DELETE" }).catch(() => {});
});

describe("Model Override — full lifecycle", () => {
  it("GET /model returns default state (no override)", async () => {
    if (!(await gatewayUp())) return;
    // First ensure clean state
    await json(`/api/agents/${AGENT_ID}/model`, { method: "DELETE" });

    const { status, body } = await json(`/api/agents/${AGENT_ID}/model`);
    assert.equal(status, 200);
    assert.equal((body as any).isOverride, false);
  });

  it("PUT /model sets override to haiku", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${AGENT_ID}/model`, {
      method: "PUT",
      body: { model: "haiku" },
    });
    assert.equal(status, 200);
  });

  it("GET /model reflects haiku override", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${AGENT_ID}/model`);
    assert.equal(status, 200);
    assert.equal((body as any).isOverride, true);
    // Model should be resolved alias
    const model = (body as any).model;
    assert.ok(model, "Should have model field");
    assert.ok(
      model.includes("haiku") || model === "haiku",
      `Model should contain 'haiku', got: ${model}`
    );
  });

  it("PUT /model changes override to sonnet", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${AGENT_ID}/model`, {
      method: "PUT",
      body: { model: "sonnet" },
    });
    assert.equal(status, 200);

    const { body } = await json(`/api/agents/${AGENT_ID}/model`);
    assert.equal((body as any).isOverride, true);
    const model = (body as any).model;
    assert.ok(model.includes("sonnet") || model === "sonnet");
  });

  it("DELETE /model removes override", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${AGENT_ID}/model`, { method: "DELETE" });
    assert.equal(status, 200);

    const { body } = await json(`/api/agents/${AGENT_ID}/model`);
    assert.equal((body as any).isOverride, false);
  });
});

describe("Model Override — alias resolution", () => {
  const aliases = ["opus", "sonnet", "haiku"];

  for (const alias of aliases) {
    it(`resolves "${alias}" alias`, async () => {
      if (!(await gatewayUp())) return;
      const { status } = await json(`/api/agents/${AGENT_ID}/model`, {
        method: "PUT",
        body: { model: alias },
      });
      assert.equal(status, 200);

      const { body } = await json(`/api/agents/${AGENT_ID}/model`);
      assert.equal((body as any).isOverride, true);
      assert.ok((body as any).model, `Should resolve alias "${alias}"`);

      // Cleanup
      await json(`/api/agents/${AGENT_ID}/model`, { method: "DELETE" });
    });
  }
});

describe("Model Override — per-agent isolation", () => {
  it("override on one agent doesn't affect another", async () => {
    if (!(await gatewayUp())) return;
    // Set override on hub-lite
    await json(`/api/agents/${AGENT_ID}/model`, {
      method: "PUT",
      body: { model: "haiku" },
    });

    // Check agentcreator has no override
    const { body } = await json("/api/agents/agentcreator/model");
    assert.equal((body as any).isOverride, false);

    // Cleanup
    await json(`/api/agents/${AGENT_ID}/model`, { method: "DELETE" });
  });
});
