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

async function raw(url: string) {
  const res = await fetch(`${BASE}${url}`);
  return { status: res.status, text: await res.text() };
}

describe("Lab page", () => {
  it("GET /lab serves lab.html with Lab title", async () => {
    if (!(await gatewayUp())) return;
    const { status, text } = await raw("/lab");
    assert.equal(status, 200);
    assert.ok(text.includes("Lab"), "Page should contain Lab");
    assert.ok(text.includes("MyAIforOne Lite"), "Page should contain app name");
  });

  it("lab.html contains access guard script", async () => {
    if (!(await gatewayUp())) return;
    const { text } = await raw("/lab");
    assert.ok(text.includes("labEnabled"), "Should have labEnabled access guard");
  });

  it("lab.html contains all 4 creator tiles", async () => {
    if (!(await gatewayUp())) return;
    const { text } = await raw("/lab");
    assert.ok(text.includes("showIntake('agent')"), "Should have agent tile");
    assert.ok(text.includes("showIntake('skill')"), "Should have skill tile");
    assert.ok(text.includes("showIntake('app')"), "Should have app tile");
    assert.ok(text.includes("showIntake('prompt')"), "Should have prompt tile");
  });

  it("lab.html contains CREATOR_AGENTS config", async () => {
    if (!(await gatewayUp())) return;
    const { text } = await raw("/lab");
    assert.ok(text.includes("agentcreator"), "Should reference agentcreator");
    assert.ok(text.includes("skillcreator"), "Should reference skillcreator");
    assert.ok(text.includes("appcreator"), "Should reference appcreator");
    assert.ok(text.includes("promptcreator"), "Should reference promptcreator");
  });

  it("lab.html does NOT contain auth.js or server-mode.js", async () => {
    if (!(await gatewayUp())) return;
    const { text } = await raw("/lab");
    assert.ok(!text.includes('src="/auth.js"'), "Should not include auth.js");
    assert.ok(!text.includes('src="/server-mode.js"'), "Should not include server-mode.js");
    assert.ok(!text.includes('src="/lite-mode.js"'), "Should not include lite-mode.js");
  });

  it("lab.html contains Lite topbar with Lab tab active", async () => {
    if (!(await gatewayUp())) return;
    const { text } = await raw("/lab");
    assert.ok(text.includes('href="/lab" class="tab-btn active"'), "Lab tab should be active");
    assert.ok(text.includes('href="/" class="tab-btn"'), "Chat tab should be present");
    assert.ok(text.includes('href="/org" class="tab-btn"'), "Agents tab should be present");
  });

  it("lab.html contains streaming chat infrastructure", async () => {
    if (!(await gatewayUp())) return;
    const { text } = await raw("/lab");
    assert.ok(text.includes("sendMessage"), "Should have sendMessage function");
    assert.ok(text.includes("streamJob"), "Should have streamJob function");
    assert.ok(text.includes("/api/chat/"), "Should reference chat API");
  });

  it("lab.html contains canvas panel", async () => {
    if (!(await gatewayUp())) return;
    const { text } = await raw("/lab");
    assert.ok(text.includes("canvasPanel"), "Should have canvas panel");
    assert.ok(text.includes("extractCanvasBlocks"), "Should extract canvas blocks");
    assert.ok(text.includes("renderCanvas"), "Should render canvas");
  });

  it("lab.html hides platform agents from artifact list", async () => {
    if (!(await gatewayUp())) return;
    const { text } = await raw("/lab");
    assert.ok(text.includes("HIDDEN_AGENT_IDS"), "Should filter hidden agent IDs");
    assert.ok(text.includes("hub-lite"), "Should hide hub-lite");
  });
});

describe("Lab feature flag", () => {
  it("labEnabled can be toggled via API", async () => {
    if (!(await gatewayUp())) return;
    // Read current
    const { body: before } = await json("/api/config/service");
    const original = (before as any).labEnabled;

    // Enable
    await json("/api/config/service", {
      method: "PUT",
      body: { labEnabled: true },
    });
    const { body: enabled } = await json("/api/config/service");
    assert.equal((enabled as any).labEnabled, true);

    // Disable
    await json("/api/config/service", {
      method: "PUT",
      body: { labEnabled: false },
    });
    const { body: disabled } = await json("/api/config/service");
    assert.equal((disabled as any).labEnabled, false);

    // Restore
    await json("/api/config/service", {
      method: "PUT",
      body: { labEnabled: original },
    });
  });
});

describe("Lab nav tab injection", () => {
  it("index.html has conditional Lab tab script", async () => {
    if (!(await gatewayUp())) return;
    const { text } = await raw("/");
    assert.ok(text.includes("mainTabGroup"), "Should have mainTabGroup ID for dynamic tab injection");
    assert.ok(text.includes("labEnabled"), "Should check labEnabled to inject Lab tab");
  });

  it("org.html has conditional Lab tab script", async () => {
    if (!(await gatewayUp())) return;
    const { text } = await raw("/org");
    assert.ok(text.includes("mainTabGroup"), "Should have mainTabGroup ID");
    assert.ok(text.includes("labEnabled"), "Should check labEnabled");
  });
});

describe("Lab — creator agent chat", () => {
  it("can start a chat stream with agentcreator", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/chat/agentcreator/stream", {
      method: "POST",
      body: { text: "Hello, what can you create?" },
    });
    assert.equal(status, 200);
    assert.ok((body as any).jobId, "Should return a jobId for agentcreator");
  });

  it("can start a chat stream with skillcreator", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/chat/skillcreator/stream", {
      method: "POST",
      body: { text: "Hello" },
    });
    assert.equal(status, 200);
    assert.ok((body as any).jobId);
  });

  it("can start a chat stream with appcreator", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/chat/appcreator/stream", {
      method: "POST",
      body: { text: "Hello" },
    });
    assert.equal(status, 200);
    assert.ok((body as any).jobId);
  });

  it("can start a chat stream with promptcreator", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/chat/promptcreator/stream", {
      method: "POST",
      body: { text: "Hello" },
    });
    assert.equal(status, 200);
    assert.ok((body as any).jobId);
  });
});
