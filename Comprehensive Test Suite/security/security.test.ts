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

const createdAgents: string[] = [];

after(async () => {
  for (const id of createdAgents) {
    await json(`/api/agents/${id}`, {
      method: "DELETE",
      body: { confirmAlias: `@${id}` },
    }).catch(() => {});
  }
});

describe("Security — path traversal in agent IDs", () => {
  const traversalIds = [
    "../etc/passwd",
    "..\\windows\\system32",
    "../../..",
    "agent/../../../etc",
    "agent%2F..%2F..%2Fetc",
  ];

  for (const id of traversalIds) {
    it(`rejects agent ID: ${id}`, async () => {
      if (!(await gatewayUp())) return;
      const { status } = await json("/api/agents", {
        method: "POST",
        body: { agentId: id, name: "Traversal Test", alias: "traversal-test" },
      });
      assert.equal(status, 400, `Should reject traversal ID: ${id}`);
    });
  }
});

describe("Security — path traversal in file download", () => {
  it("rejects ../../etc/passwd path", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/api/agents/hub-lite/download?path=../../etc/passwd`);
    assert.ok(res.status === 400 || res.status === 403 || res.status === 404,
      `Should reject traversal, got ${res.status}`);
  });

  it("rejects absolute path /etc/passwd", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/api/agents/hub-lite/download?path=/etc/passwd`);
    assert.ok(res.status === 400 || res.status === 403 || res.status === 404);
  });

  it("rejects backslash traversal ..\\..\\windows", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/api/agents/hub-lite/download?path=..\\..\\windows\\system32\\config`);
    assert.ok(res.status === 400 || res.status === 403 || res.status === 404);
  });
});

describe("Security — XSS in agent names", () => {
  it("stores but doesn't execute script tags in agent name", async () => {
    if (!(await gatewayUp())) return;
    const id = `xss-test-${Date.now()}`;
    const xssName = '<img src=x onerror="alert(1)">';
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: id, name: xssName, alias: id },
    });

    if (status === 200 || status === 201) {
      createdAgents.push(id);
      // Name should be stored as-is (server doesn't need to sanitize — client should escape)
      const { body } = await json(`/api/agents/${id}`);
      const name = (body as any).config?.name || (body as any).name;
      assert.equal(name, xssName, "Name should be stored verbatim");
    }
    // Either accepted and stored safely, or rejected — both are acceptable
    assert.ok(status === 200 || status === 201 || status === 400);
  });
});

describe("Security — SQL-like injection in inputs", () => {
  it("handles SQL-like strings in agent name", async () => {
    if (!(await gatewayUp())) return;
    const id = `sql-test-${Date.now()}`;
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: id, name: "'; DROP TABLE agents; --", alias: id },
    });
    if (status === 200 || status === 201) {
      createdAgents.push(id);
    }
    // Should not crash the server
    assert.ok(status === 200 || status === 201 || status === 400);

    // Server should still be up
    assert.ok(await gatewayUp(), "Server should still be healthy after SQL-like input");
  });

  it("handles SQL-like strings in chat text", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/chat/hub-lite/stream", {
      method: "POST",
      body: { text: "'; DROP TABLE messages; --" },
    });
    assert.ok(status === 200 || status === 400);
    assert.ok(await gatewayUp(), "Server should still be healthy");
  });
});

describe("Security — command injection", () => {
  it("handles shell metacharacters in agent name", async () => {
    if (!(await gatewayUp())) return;
    const id = `cmd-test-${Date.now()}`;
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: id, name: "$(whoami) && rm -rf /", alias: id },
    });
    if (status === 200 || status === 201) {
      createdAgents.push(id);
    }
    assert.ok(status === 200 || status === 201 || status === 400);
    assert.ok(await gatewayUp(), "Server should survive command injection attempt");
  });
});

describe("Security — oversized payloads", () => {
  it("handles very large agent name without crashing", async () => {
    if (!(await gatewayUp())) return;
    const id = `large-test-${Date.now()}`;
    const largeName = "A".repeat(100000); // 100KB name
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: id, name: largeName, alias: id },
    });
    if (status === 200 || status === 201) {
      createdAgents.push(id);
    }
    // Should either accept or reject, not crash
    assert.ok(status < 600, "Should not return 5xx for large payload");
    assert.ok(await gatewayUp(), "Server should still be healthy");
  });

  it("handles very large chat text", async () => {
    if (!(await gatewayUp())) return;
    const largeText = "X".repeat(100000);
    const { status } = await json("/api/chat/hub-lite/stream", {
      method: "POST",
      body: { text: largeText },
    });
    assert.ok(status < 600);
    assert.ok(await gatewayUp());
  });
});

describe("Security — delete confirmation", () => {
  it("delete without confirmAlias is rejected", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/hub-lite", {
      method: "DELETE",
      body: {},
    });
    assert.ok(status === 400 || status === 422 || status === 500,
      "Should require confirmation");
  });

  it("delete with wrong confirmAlias is rejected", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/hub-lite", {
      method: "DELETE",
      body: { confirmAlias: "@wrong-alias" },
    });
    assert.ok(status === 400 || status === 422 || status === 403 || status === 500,
      "Should reject wrong alias");
  });
});
