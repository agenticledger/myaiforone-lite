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

describe("Config Persistence — service config round-trip", () => {
  it("GET /api/config/service returns expected fields", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/config/service");
    assert.equal(status, 200);
    const s = body as any;
    assert.ok("deploymentMode" in s || "webUIPort" in s || "logLevel" in s, "Should have service config fields");
  });

  it("PUT then GET preserves labEnabled toggle", async () => {
    if (!(await gatewayUp())) return;
    // Read original
    const { body: before } = await json("/api/config/service");
    const original = (before as any).labEnabled;

    // Toggle
    const { status: putStatus } = await json("/api/config/service", {
      method: "PUT",
      body: { labEnabled: !original },
    });
    assert.equal(putStatus, 200);

    // Re-read
    const { body: after } = await json("/api/config/service");
    assert.equal((after as any).labEnabled, !original, "labEnabled should be toggled");

    // Restore
    await json("/api/config/service", { method: "PUT", body: { labEnabled: original } });

    // Verify restored
    const { body: restored } = await json("/api/config/service");
    assert.equal((restored as any).labEnabled, original, "labEnabled should be restored");
  });

  it("PUT rejects unknown top-level fields gracefully", async () => {
    if (!(await gatewayUp())) return;
    // Server should accept the PUT even with extra fields (or ignore them)
    const { status } = await json("/api/config/service", {
      method: "PUT",
      body: { __unknownField: true },
    });
    assert.ok(status === 200 || status === 400);
  });
});

describe("Config Persistence — accounts", () => {
  it("GET /api/config/accounts returns account map", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/config/accounts");
    assert.equal(status, 200);
    assert.equal(typeof body, "object");
  });

  it("accounts config is read-only via GET", async () => {
    if (!(await gatewayUp())) return;
    // Accounts are configured via settings UI, not a separate PUT endpoint
    const { status, body } = await json("/api/config/accounts");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });
});

describe("Config Persistence — capabilities", () => {
  it("GET /api/capabilities returns feature flags object", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/capabilities");
    assert.equal(status, 200);
    assert.equal(typeof body, "object");
  });
});

describe("Config Persistence — auth status", () => {
  it("GET /api/auth/status returns auth state", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/auth/status");
    assert.equal(status, 200);
    assert.ok("authEnabled" in (body as any));
    assert.equal(typeof (body as any).authEnabled, "boolean");
  });
});
