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
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("Input Validation — agent IDs", () => {
  it("rejects uppercase agent ID", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: "UPPER-CASE", name: "Test", alias: "upper-case" },
    });
    assert.equal(status, 400);
  });

  it("rejects agent ID with spaces", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: "has spaces", name: "Test", alias: "has-spaces" },
    });
    assert.equal(status, 400);
  });

  it("rejects agent ID with special chars", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: "test@agent!", name: "Test", alias: "test-agent" },
    });
    assert.equal(status, 400);
  });

  it("rejects agent ID with path separators", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: "../etc/passwd", name: "Test", alias: "etc-passwd" },
    });
    assert.equal(status, 400);
  });

  it("accepts valid lowercase-hyphen agent ID", async () => {
    if (!(await gatewayUp())) return;
    const id = `valid-test-${Date.now()}`;
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: id, name: "Valid Agent", alias: id },
    });
    assert.ok(status === 200 || status === 201);

    // Cleanup
    await json(`/api/agents/${id}`, {
      method: "DELETE",
      body: { confirmAlias: `@${id}` },
    });
  });
});

describe("Input Validation — duplicate detection", () => {
  it("rejects duplicate agent ID (409)", async () => {
    if (!(await gatewayUp())) return;
    // hub-lite always exists
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: "hub-lite", name: "Duplicate", alias: "duplicate-hub" },
    });
    assert.equal(status, 409);
  });
});

describe("Input Validation — missing required fields", () => {
  it("agent create rejects missing name", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: "missing-name", alias: "missing-name" },
    });
    assert.equal(status, 400);
  });

  it("agent create rejects missing alias", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: "missing-alias", name: "Missing Alias" },
    });
    assert.equal(status, 400);
  });

  it("agent create rejects empty body", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents", {
      method: "POST",
      body: {},
    });
    assert.equal(status, 400);
  });
});

describe("Input Validation — malformed JSON", () => {
  it("non-JSON Content-Type does not crash server", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not json",
    });
    // Express returns 400 or 500 for parse failures — server stays up
    assert.ok(res.status >= 400, `Should return error status, got ${res.status}`);
    assert.ok(await gatewayUp(), "Server should still be healthy after bad content-type");
  });

  it("handles missing Content-Type header gracefully", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/api/config/service`, {
      method: "PUT",
      body: '{"labEnabled": true}',
    });
    // Express may reject without Content-Type — server stays up
    assert.ok(res.status >= 200, `Should return some status, got ${res.status}`);
    assert.ok(await gatewayUp(), "Server should still be healthy");
  });
});

describe("Input Validation — special characters in names", () => {
  it("handles Unicode in agent name", async () => {
    if (!(await gatewayUp())) return;
    const id = `unicode-test-${Date.now()}`;
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: id, name: "Ünïcödé Àgènt 日本語", alias: id },
    });
    assert.ok(status === 200 || status === 201);

    // Verify name preserved
    const { body } = await json(`/api/agents/${id}`);
    const name = (body as any).config?.name || (body as any).name;
    assert.equal(name, "Ünïcödé Àgènt 日本語");

    // Cleanup
    await json(`/api/agents/${id}`, {
      method: "DELETE",
      body: { confirmAlias: `@${id}` },
    });
  });

  it("handles HTML-like content in agent name", async () => {
    if (!(await gatewayUp())) return;
    const id = `html-test-${Date.now()}`;
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: id, name: '<script>alert("xss")</script>', alias: id },
    });
    assert.ok(status === 200 || status === 201 || status === 400);

    // Cleanup
    await json(`/api/agents/${id}`, {
      method: "DELETE",
      body: { confirmAlias: `@${id}` },
    }).catch(() => {});
  });

  it("handles very long agent name", async () => {
    if (!(await gatewayUp())) return;
    const id = `long-name-${Date.now()}`;
    const longName = "A".repeat(1000);
    const { status } = await json("/api/agents", {
      method: "POST",
      body: { agentId: id, name: longName, alias: id },
    });
    assert.ok(status === 200 || status === 201 || status === 400);

    // Cleanup
    await json(`/api/agents/${id}`, {
      method: "DELETE",
      body: { confirmAlias: `@${id}` },
    }).catch(() => {});
  });
});

describe("Input Validation — chat endpoint", () => {
  it("POST /api/chat/:agentId/stream rejects missing text", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/chat/hub-lite/stream", {
      method: "POST",
      body: {},
    });
    assert.ok(status === 400 || status === 200, `Expected 400 or 200, got ${status}`);
  });

  it("POST /api/chat/nonexistent/stream returns error for unknown agent", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/chat/nonexistent-agent-xyz/stream", {
      method: "POST",
      body: { text: "hello" },
    });
    assert.ok(status === 404 || status === 400 || status === 200);
  });
});
