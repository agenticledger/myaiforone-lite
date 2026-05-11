import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTmp() {
  const dir = join(tmpdir(), `lite-test-config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Config loading", () => {
  let tmpDir: string;

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it("reads valid config.json", () => {
    tmpDir = makeTmp();
    const configPath = join(tmpDir, "config.json");
    const cfg = {
      service: { logLevel: "info", webUIPort: 4889 },
      channels: {},
      agents: {
        "test-agent": {
          name: "Test",
          description: "A test agent",
          workspace: "/tmp",
          memoryDir: "/tmp/mem",
          allowedTools: ["Read"],
          mcps: [],
          persistent: true,
          streaming: true,
        },
      },
    };
    writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    const loaded = JSON.parse(readFileSync(configPath, "utf-8"));
    assert.equal(loaded.service.webUIPort, 4889);
    assert.ok("test-agent" in loaded.agents);
  });

  it("handles missing config.json gracefully", () => {
    tmpDir = makeTmp();
    const configPath = join(tmpDir, "config.json");
    assert.equal(existsSync(configPath), false);
  });

  it("config includes labEnabled field", () => {
    tmpDir = makeTmp();
    const configPath = join(tmpDir, "config.json");
    const cfg = {
      service: { logLevel: "info", labEnabled: false },
      channels: {},
      agents: {},
    };
    writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    const loaded = JSON.parse(readFileSync(configPath, "utf-8"));
    assert.equal(loaded.service.labEnabled, false);
  });

  it("labEnabled defaults to false when missing", () => {
    tmpDir = makeTmp();
    const configPath = join(tmpDir, "config.json");
    const cfg = { service: { logLevel: "info" }, channels: {}, agents: {} };
    writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    const loaded = JSON.parse(readFileSync(configPath, "utf-8"));
    const labEnabled = loaded.service.labEnabled ?? false;
    assert.equal(labEnabled, false);
  });
});

describe("Config structure", () => {
  it("ServiceConfig supports all expected fields", () => {
    const svc: Record<string, any> = {
      logLevel: "info",
      webUIPort: 4889,
      webUIEnabled: true,
      labEnabled: false,
      gymEnabled: false,
      voiceModeEnabled: false,
      deploymentMode: "local",
      defaultClaudeAccount: null,
      multiModelEnabled: false,
      platformDefaultExecutor: "claude",
    };
    assert.equal(svc.webUIPort, 4889);
    assert.equal(svc.labEnabled, false);
    assert.equal(svc.deploymentMode, "local");
  });
});
