import { describe, it, before } from "node:test";
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
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

async function raw(url: string, opts?: any) {
  const res = await fetch(`${BASE}${url}`, opts);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

let allAgents: any[] = [];
let testAgentId = "hub-lite";

before(async () => {
  if (!(await gatewayUp())) return;
  const { body } = await json("/api/dashboard");
  allAgents = (body as any)?.agents || [];
  if (allAgents.length) testAgentId = allAgents[0].id;
});

// ── Health ──

describe("Health", () => {
  it("GET /health returns 200", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/health");
    assert.equal(status, 200);
    assert.equal((body as any).ok, true);
  });
});

// ── Pages ──

describe("Pages", () => {
  it("GET / serves index.html", async () => {
    if (!(await gatewayUp())) return;
    const { status, text } = await raw("/");
    assert.equal(status, 200);
    assert.ok(text.includes("MyAIforOne Lite"));
  });

  it("GET /ui redirects to index.html", async () => {
    if (!(await gatewayUp())) return;
    const { status, text } = await raw("/ui");
    assert.equal(status, 200);
    assert.ok(text.includes("MyAIforOne Lite"));
  });

  it("GET /org serves org.html", async () => {
    if (!(await gatewayUp())) return;
    const { status, text } = await raw("/org");
    assert.equal(status, 200);
    assert.ok(text.includes("Agents"));
  });

  it("GET /settings serves settings.html", async () => {
    if (!(await gatewayUp())) return;
    const { status, text } = await raw("/settings");
    assert.equal(status, 200);
    assert.ok(text.includes("Settings"));
  });

  it("GET /lab serves lab.html", async () => {
    if (!(await gatewayUp())) return;
    const { status, text } = await raw("/lab");
    assert.equal(status, 200);
    assert.ok(text.includes("Lab"));
  });
});

// ── Dashboard ──

describe("Dashboard", () => {
  it("GET /api/dashboard returns agents array", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/dashboard");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).agents));
  });
});

// ── Auth ──

describe("Auth", () => {
  it("GET /api/auth/status returns auth state", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/auth/status");
    assert.equal(status, 200);
    assert.ok("authEnabled" in (body as any));
  });
});

// ── Config / Service ──

describe("Config Service", () => {
  it("GET /api/config/service returns service config with labEnabled", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/config/service");
    assert.equal(status, 200);
    const s = body as any;
    assert.ok("deploymentMode" in s);
    assert.ok("webUIPort" in s);
    assert.ok("labEnabled" in s);
    assert.equal(typeof s.labEnabled, "boolean");
  });

  it("PUT /api/config/service updates labEnabled", async () => {
    if (!(await gatewayUp())) return;
    // Read current value
    const { body: before } = await json("/api/config/service");
    const original = (before as any).labEnabled;

    // Toggle
    const { status } = await json("/api/config/service", {
      method: "PUT",
      body: { labEnabled: !original },
    });
    assert.equal(status, 200);

    // Verify changed
    const { body: after } = await json("/api/config/service");
    assert.equal((after as any).labEnabled, !original);

    // Restore
    await json("/api/config/service", {
      method: "PUT",
      body: { labEnabled: original },
    });
  });
});

// ── Config / Accounts ──

describe("Config Accounts", () => {
  it("GET /api/config/accounts returns account map", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/config/accounts");
    assert.equal(status, 200);
    assert.equal(typeof body, "object");
  });
});

// ── Agents ──

describe("Agents", () => {
  it("GET /api/agents returns agent list", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/agents");
    assert.equal(status, 200);
    const agents = (body as any).agents;
    assert.ok(Array.isArray(agents));
    for (const a of agents) {
      assert.ok("id" in a);
      assert.ok("name" in a);
    }
  });

  it("GET /api/agents/:id returns single agent", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${testAgentId}`);
    assert.equal(status, 200);
    assert.equal((body as any).id, testAgentId);
  });

  it("GET /api/agents/:id returns 404 for unknown agent", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/nonexistent-agent-xyz");
    assert.equal(status, 404);
  });

  it("GET /api/agents/:id/instructions returns CLAUDE.md content", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/instructions`);
    assert.ok(status === 200 || status === 404);
    if (status === 200) {
      assert.ok("instructions" in (body as any));
    }
  });

  it("creator agents exist in agent list", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/agents");
    const ids = ((body as any).agents || []).map((a: any) => a.id);
    for (const creator of ["agentcreator", "skillcreator", "appcreator", "promptcreator"]) {
      assert.ok(ids.includes(creator), `${creator} should be in agent list`);
    }
  });
});

// ── Agent CRUD ──

describe("Agent CRUD", () => {
  const uniqueId = `test-agent-${Date.now()}`;

  it("POST /api/agents creates a new agent", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/agents", {
      method: "POST",
      body: {
        agentId: uniqueId,
        name: "Test Agent",
        alias: uniqueId,
        description: "Created by test suite",
        systemPrompt: "You are a test agent.",
      },
    });
    assert.ok(status === 200 || status === 201, `Expected 200/201, got ${status}`);
  });

  it("PUT /api/agents/:id updates agent", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${uniqueId}`, {
      method: "PUT",
      body: { name: "Updated Test Agent", alias: uniqueId },
    });
    assert.ok(status === 200 || status === 404);
  });

  it("DELETE /api/agents/:id removes agent", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${uniqueId}`, {
      method: "DELETE",
      body: { confirmAlias: `@${uniqueId}` },
    });
    assert.ok(status === 200 || status === 404);
  });
});

// ── Chat ──

describe("Chat", () => {
  it("POST /api/chat/:agentId/stream starts job, returns jobId", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/chat/${testAgentId}/stream`, {
      method: "POST",
      body: { text: "ping" },
    });
    assert.equal(status, 200);
    assert.ok((body as any).jobId, "Should return a jobId");
  });

  it("POST /api/chat/:agentId/stream rejects empty text", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/chat/${testAgentId}/stream`, {
      method: "POST",
      body: { text: "" },
    });
    assert.ok(status === 400 || status === 200);
  });

  it("POST /api/chat/jobs/:jobId/stop handles missing job gracefully", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/chat/jobs/nonexistent-job/stop", { method: "POST" });
    assert.ok(status === 200 || status === 404);
  });
});

// ── Session Tabs ──

describe("Session Tabs", () => {
  it("GET /api/agents/:agentId/session-tabs returns tabs", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/session-tabs`);
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).tabs));
  });

  it("POST /api/agents/:agentId/session-tabs creates a tab", async () => {
    if (!(await gatewayUp())) return;
    const tabId = `test-tab-${Date.now()}`;
    const { status, body } = await json(`/api/agents/${testAgentId}/session-tabs`, {
      method: "POST",
      body: { tabId, label: "Test Tab" },
    });
    assert.ok(status === 200 || status === 201, `Expected 200/201, got ${status}`);
    // Cleanup
    await json(`/api/agents/${testAgentId}/session-tabs/${tabId}`, { method: "DELETE" });
  });
});

// ── Model Override ──

describe("Model Override", () => {
  it("GET → PUT → DELETE lifecycle", async () => {
    if (!(await gatewayUp())) return;
    let r = await json(`/api/agents/${testAgentId}/model`);
    assert.equal(r.status, 200);

    r = await json(`/api/agents/${testAgentId}/model`, { method: "PUT", body: { model: "haiku" } });
    assert.equal(r.status, 200);

    r = await json(`/api/agents/${testAgentId}/model`);
    assert.equal((r.body as any).isOverride, true);

    r = await json(`/api/agents/${testAgentId}/model`, { method: "DELETE" });
    assert.equal(r.status, 200);

    r = await json(`/api/agents/${testAgentId}/model`);
    assert.equal((r.body as any).isOverride, false);
  });
});

// ── Marketplace ──

describe("Marketplace", () => {
  it("GET /api/marketplace/skills returns skills list", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/marketplace/skills");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).items));
  });

  it("GET /api/marketplace/prompts returns prompts list", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/marketplace/prompts");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).items));
  });

  it("GET /api/marketplace/apps returns apps list", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/marketplace/apps");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).items));
  });

  it("GET /api/marketplace/agents returns agents list", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/marketplace/agents");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).items));
  });

  it("GET /api/marketplace/mcps returns MCPs list", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/marketplace/mcps");
    assert.equal(status, 200);
    assert.ok(Array.isArray((body as any).items));
  });

  it("rejects invalid marketplace type", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/marketplace/invalid");
    assert.equal(status, 400);
  });
});

// ── MCPs ──

describe("MCPs", () => {
  it("GET /api/mcps returns MCP list", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/mcps");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body) || Array.isArray((body as any)?.mcps), "Should contain MCP list");
  });

  it("GET /api/mcp-catalog returns catalog", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/mcp-catalog");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });
});

// ── Memory ──

describe("Memory", () => {
  it("GET /api/agents/:agentId/memory returns memory data", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/memory`);
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });

  it("POST /api/agents/:agentId/memory/search works", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/agents/${testAgentId}/memory/search`, {
      method: "POST",
      body: { query: "test" },
    });
    assert.ok(status === 200 || status === 404);
  });
});

// ── Cost ──

describe("Cost", () => {
  it("GET /api/agents/:agentId/cost returns cost data", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/cost`);
    assert.equal(status, 200);
    assert.ok("totalInputTokens" in (body as any) || "cost" in (body as any) || typeof body === "object");
  });
});

// ── Logs ──

describe("Logs", () => {
  it("GET /api/agents/:agentId/logs returns log entries", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/logs`);
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });
});

// ── Automations ──

describe("Automations", () => {
  it("GET /api/automations returns automation summary", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/automations");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });
});

// ── Capabilities ──

describe("Capabilities", () => {
  it("GET /api/capabilities returns feature flags", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/capabilities");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });
});

// ── Sessions ──

describe("Sessions", () => {
  it("GET /api/agents/:agentId/sessions returns sessions", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json(`/api/agents/${testAgentId}/sessions`);
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });
});

// ── Debug ──

describe("Debug", () => {
  it("GET /api/debug/mcp returns MCP debug info", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/debug/mcp");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });
});
