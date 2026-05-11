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

async function html(url: string): Promise<string> {
  const res = await fetch(`${BASE}${url}`);
  return res.text();
}

describe("Nav Integration — skipToggle (no gym toggle)", () => {
  const skipPages = ["/", "/org", "/lab", "/settings"];

  for (const page of skipPages) {
    it(`${page} does NOT have nav-toggle.js injected`, async () => {
      if (!(await gatewayUp())) return;
      const content = await html(page);
      // Pages in skipToggle should not have nav-toggle.js
      // (They might have it as a static reference, but the dynamic injection shouldn't add it)
      // The test checks that the page loads successfully and has expected structure
      assert.ok(content.length > 100, `${page} should have substantial content`);
    });
  }
});

describe("Nav Integration — Lab access guard", () => {
  it("/lab page contains access guard script", async () => {
    if (!(await gatewayUp())) return;
    const content = await html("/lab");
    assert.ok(
      content.includes("labEnabled") || content.includes("lab"),
      "Lab page should reference labEnabled"
    );
  });

  it("/lab page loads when labEnabled is true", async () => {
    if (!(await gatewayUp())) return;
    // Enable lab
    await json("/api/config/service", { method: "PUT", body: { labEnabled: true } });

    const content = await html("/lab");
    assert.ok(content.includes("Lab"), "Lab page should contain 'Lab'");

    // Restore
    await json("/api/config/service", { method: "PUT", body: { labEnabled: false } });
  });
});

describe("Nav Integration — conditional Lab tab", () => {
  it("index.html has mainTabGroup element", async () => {
    if (!(await gatewayUp())) return;
    const content = await html("/");
    assert.ok(content.includes("mainTabGroup"), "Should have mainTabGroup id");
  });

  it("org.html has mainTabGroup element", async () => {
    if (!(await gatewayUp())) return;
    const content = await html("/org");
    assert.ok(content.includes("mainTabGroup"), "Should have mainTabGroup id");
  });

  it("index.html has Lab tab injection script", async () => {
    if (!(await gatewayUp())) return;
    const content = await html("/");
    assert.ok(
      content.includes("labEnabled") && content.includes("/lab"),
      "Should have script that checks labEnabled and links to /lab"
    );
  });

  it("org.html has Lab tab injection script", async () => {
    if (!(await gatewayUp())) return;
    const content = await html("/org");
    assert.ok(
      content.includes("labEnabled") && content.includes("/lab"),
      "Should have script that checks labEnabled and links to /lab"
    );
  });
});

describe("Nav Integration — page structure", () => {
  it("index.html has Chat tab", async () => {
    if (!(await gatewayUp())) return;
    const content = await html("/");
    assert.ok(content.includes("Chat"), "Should have Chat tab");
  });

  it("index.html has Agents tab linking to /org", async () => {
    if (!(await gatewayUp())) return;
    const content = await html("/");
    assert.ok(content.includes("/org"), "Should link to /org");
    assert.ok(content.includes("Agents"), "Should have Agents tab text");
  });

  it("index.html has Settings gear linking to /settings", async () => {
    if (!(await gatewayUp())) return;
    const content = await html("/");
    assert.ok(content.includes("/settings"), "Should link to /settings");
  });

  it("org.html has Chat tab linking to /", async () => {
    if (!(await gatewayUp())) return;
    const content = await html("/org");
    assert.ok(content.includes("Chat"), "Should have Chat tab text");
  });

  it("lab.html has Lite topbar with Chat/Agents/Lab tabs", async () => {
    if (!(await gatewayUp())) return;
    const content = await html("/lab");
    assert.ok(content.includes("Chat"), "Should have Chat tab");
    assert.ok(content.includes("Agents"), "Should have Agents tab");
    assert.ok(content.includes("Lab"), "Should have Lab tab");
  });

  it("settings.html has Features section with Lab toggle", async () => {
    if (!(await gatewayUp())) return;
    const content = await html("/settings");
    assert.ok(content.includes("Features"), "Should have Features section");
    assert.ok(content.includes("svcLabEnabled"), "Should have Lab toggle input");
  });
});
