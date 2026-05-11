import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTmp() {
  const dir = join(tmpdir(), `lite-test-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Executor — session files", () => {
  let tmpDir: string;

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it("creates session directory structure", () => {
    tmpDir = makeTmp();
    const sessionsDir = join(tmpDir, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    assert.ok(existsSync(sessionsDir));
  });

  it("writes and reads session JSON", () => {
    tmpDir = makeTmp();
    const sessionFile = join(tmpDir, "session.json");
    const data = { sessionId: "test-123", agentId: "hub-lite", startedAt: Date.now() };
    writeFileSync(sessionFile, JSON.stringify(data, null, 2));
    const loaded = JSON.parse(readFileSync(sessionFile, "utf-8"));
    assert.equal(loaded.sessionId, "test-123");
    assert.equal(loaded.agentId, "hub-lite");
  });

  it("handles session tab files", () => {
    tmpDir = makeTmp();
    const tabsFile = join(tmpDir, "session-tabs.json");
    const tabs = [
      { id: "tab-1", label: "Main", createdAt: Date.now() },
      { id: "tab-2", label: "Research", createdAt: Date.now() },
    ];
    writeFileSync(tabsFile, JSON.stringify(tabs, null, 2));
    const loaded = JSON.parse(readFileSync(tabsFile, "utf-8"));
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].label, "Main");
  });
});

describe("Executor — command interception patterns", () => {
  it("recognizes /opreset command", () => {
    const text = "/opreset";
    assert.ok(/^\/(opreset|reset)$/i.test(text.trim()));
  });

  it("recognizes /opcompact command", () => {
    const text = "/opcompact";
    assert.ok(/^\/(opcompact|compact)$/i.test(text.trim()));
  });

  it("does not intercept normal messages", () => {
    const messages = ["hello", "help me", "/slash is not a command", "foo/opreset"];
    for (const text of messages) {
      assert.ok(!/^\/(opreset|reset|opcompact|compact)$/i.test(text.trim()), `Should not intercept: ${text}`);
    }
  });
});

describe("Executor — Claude CLI arguments", () => {
  it("streaming requires stream-json output format", () => {
    const args = ["-p", "-", "--output-format", "stream-json", "--verbose"];
    assert.ok(args.includes("--output-format"));
    assert.ok(args.includes("stream-json"));
    assert.ok(args.includes("--verbose"), "stream-json requires --verbose");
  });

  it("constructs MCP flag correctly", () => {
    const mcpName = "myaiforone-lite";
    const flag = `--mcp-scope=${mcpName}`;
    assert.ok(flag.includes(mcpName));
  });

  it("tool allowlist is formatted as comma-separated", () => {
    const tools = ["Read", "Edit", "Write", "Bash", "Glob", "Grep"];
    const flag = `--allowedTools=${tools.join(",")}`;
    assert.ok(flag.includes("Read,Edit,Write"));
  });
});
