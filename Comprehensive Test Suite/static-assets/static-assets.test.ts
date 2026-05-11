import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:4889";

async function gatewayUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

describe("Static Assets — CSS files", () => {
  it("serves canvas.css with correct MIME type", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/canvas.css`);
    assert.equal(res.status, 200);
    const ct = res.headers.get("content-type") || "";
    assert.ok(ct.includes("text/css"), `Expected text/css, got: ${ct}`);
  });

  it("serves mobile.css with correct MIME type", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/mobile.css`);
    assert.equal(res.status, 200);
    const ct = res.headers.get("content-type") || "";
    assert.ok(ct.includes("text/css"), `Expected text/css, got: ${ct}`);
  });
});

describe("Static Assets — JS files", () => {
  it("serves auth.js with correct MIME type", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/auth.js`);
    assert.equal(res.status, 200);
    const ct = res.headers.get("content-type") || "";
    assert.ok(
      ct.includes("application/javascript") || ct.includes("text/javascript"),
      `Expected JS MIME type, got: ${ct}`
    );
  });

  it("serves nav-toggle.js", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/nav-toggle.js`);
    assert.equal(res.status, 200);
  });

  it("serves canvas.js", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/canvas.js`);
    assert.equal(res.status, 200);
  });

  it("serves license-check.js", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/license-check.js`);
    assert.equal(res.status, 200);
  });
});

describe("Static Assets — avatar images", () => {
  it("serves avatar-01.png with image MIME type", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/avatars/avatar-01.png`);
    assert.equal(res.status, 200);
    const ct = res.headers.get("content-type") || "";
    assert.ok(ct.includes("image/png"), `Expected image/png, got: ${ct}`);
  });

  it("serves avatar-80.png (last avatar)", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/avatars/avatar-80.png`);
    assert.equal(res.status, 200);
  });
});

describe("Static Assets — caching headers", () => {
  it("static assets have cache-control header", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/canvas.css`);
    const cc = res.headers.get("cache-control") || "";
    assert.ok(cc.length > 0, "Should have cache-control header");
  });

  it("HTML pages have no-cache headers", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/`);
    const cc = res.headers.get("cache-control") || "";
    assert.ok(
      cc.includes("no-cache") || cc.includes("no-store"),
      `HTML should have no-cache, got: ${cc}`
    );
  });
});

describe("Static Assets — 404 handling", () => {
  it("returns 404 for nonexistent CSS file", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/nonexistent-file.css`);
    assert.equal(res.status, 404);
  });

  it("returns 404 for nonexistent JS file", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/nonexistent-file.js`);
    assert.equal(res.status, 404);
  });

  it("returns 404 for nonexistent image", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/avatars/avatar-999.png`);
    assert.equal(res.status, 404);
  });

  it("returns 404 for nonexistent API route", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/api/nonexistent-endpoint`);
    assert.equal(res.status, 404);
  });
});
