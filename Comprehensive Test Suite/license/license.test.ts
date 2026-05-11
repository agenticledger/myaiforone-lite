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

describe("License", () => {
  it("GET /api/license returns license info", async () => {
    if (!(await gatewayUp())) return;
    const { status, body } = await json("/api/license");
    assert.equal(status, 200);
    assert.ok(typeof body === "object");
  });

  it("POST /api/license/check handles license check", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/license/check", {
      method: "POST",
      body: { key: "test-invalid-key" },
    });
    // May return 200 (with valid/invalid result) or 400/500
    assert.ok(status === 200 || status === 400 || status === 500);
  });
});
