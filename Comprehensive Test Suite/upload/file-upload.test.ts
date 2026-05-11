import { describe, it } from "node:test";
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

describe("File Upload — JSON/base64", () => {
  it("POST /api/upload/:agentId/json uploads a text file", async () => {
    if (!(await gatewayUp())) return;
    const content = Buffer.from("Hello from test suite").toString("base64");
    const { status, body } = await json(`/api/upload/${AGENT_ID}/json`, {
      method: "POST",
      body: {
        fileName: "test-upload.txt",
        base64Content: content,
        mode: "temp",
      },
    });
    assert.ok(status === 200 || status === 201, `Expected 200/201, got ${status}: ${JSON.stringify(body)}`);
    assert.ok((body as any).ok || (body as any).path, "Should confirm upload");
    if ((body as any).fileName) {
      assert.equal((body as any).fileName, "test-upload.txt");
    }
  });

  it("POST /api/upload/:agentId/json rejects missing fileName", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/upload/${AGENT_ID}/json`, {
      method: "POST",
      body: { base64Content: "dGVzdA==" },
    });
    assert.equal(status, 400);
  });

  it("POST /api/upload/:agentId/json rejects missing base64Content", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json(`/api/upload/${AGENT_ID}/json`, {
      method: "POST",
      body: { fileName: "test.txt" },
    });
    assert.equal(status, 400);
  });

  it("POST /api/upload/:agentId/json supports permanent mode", async () => {
    if (!(await gatewayUp())) return;
    const content = Buffer.from("Permanent file content").toString("base64");
    const { status, body } = await json(`/api/upload/${AGENT_ID}/json`, {
      method: "POST",
      body: {
        fileName: "test-permanent.txt",
        base64Content: content,
        mode: "permanent",
      },
    });
    assert.ok(status === 200 || status === 201);
    if ((body as any).mode) {
      assert.equal((body as any).mode, "permanent");
    }
  });

  it("returns 404 for nonexistent agent upload", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/upload/nonexistent-agent-xyz/json", {
      method: "POST",
      body: {
        fileName: "test.txt",
        base64Content: "dGVzdA==",
      },
    });
    assert.ok(status === 404 || status === 400, `Expected 404/400, got ${status}`);
  });
});

describe("File Upload — multipart", () => {
  it("POST /api/upload/:agentId accepts multipart form data", async () => {
    if (!(await gatewayUp())) return;
    const boundary = "----TestBoundary" + Date.now();
    const fileContent = "Multipart test content";
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="multipart-test.txt"`,
      `Content-Type: text/plain`,
      ``,
      fileContent,
      `--${boundary}`,
      `Content-Disposition: form-data; name="mode"`,
      ``,
      `temp`,
      `--${boundary}--`,
    ].join("\r\n");

    const res = await fetch(`${BASE}/api/upload/${AGENT_ID}`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const data = await res.json().catch(() => null);
    assert.ok(res.status === 200 || res.status === 201, `Upload failed: ${res.status} ${JSON.stringify(data)}`);
  });
});

describe("File Download", () => {
  it("GET /api/agents/:agentId/download returns 400 without path param", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/api/agents/${AGENT_ID}/download`);
    assert.ok(res.status === 400 || res.status === 404);
  });

  it("GET /api/agents/:agentId/download rejects path traversal", async () => {
    if (!(await gatewayUp())) return;
    const res = await fetch(`${BASE}/api/agents/${AGENT_ID}/download?path=../../etc/passwd`);
    assert.ok(res.status === 400 || res.status === 403 || res.status === 404);
  });
});
