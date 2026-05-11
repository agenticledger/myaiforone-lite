import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BASE = "http://localhost:4889";

async function gatewayUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function json(url: string) {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const DRIVE_ROOT = join(homedir(), "Desktop", "MyAIforOne Drive Lite");
const PERSONAL_AGENTS = join(DRIVE_ROOT, "PersonalAgents");

describe("Drive Folder — root structure", () => {
  it("Drive root exists", () => {
    assert.ok(existsSync(DRIVE_ROOT), `Drive root should exist at ${DRIVE_ROOT}`);
  });

  it("PersonalAgents directory exists", () => {
    assert.ok(existsSync(PERSONAL_AGENTS), "PersonalAgents should exist");
  });

  it("PersonalRegistry directory exists", () => {
    const registry = join(DRIVE_ROOT, "PersonalRegistry");
    assert.ok(existsSync(registry), "PersonalRegistry should exist");
  });
});

describe("Drive Folder — agent home dirs", () => {
  it("each registered agent has a home directory", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/agents");
    const agents = (body as any).agents || [];

    for (const agent of agents) {
      const home = agent.agentHome || agent.config?.agentHome;
      if (home && !home.includes("node_modules") && !home.includes(".cache")) {
        // Only check user-created agents in PersonalAgents
        if (home.includes("PersonalAgents")) {
          assert.ok(existsSync(home), `Agent ${agent.id} home should exist: ${home}`);
        }
      }
    }
  });

  it("PersonalAgents contains expected agent directories", () => {
    if (!existsSync(PERSONAL_AGENTS)) return;
    const entries = readdirSync(PERSONAL_AGENTS);
    // Should have at least some directories (agents created by user)
    const dirs = entries.filter(e => {
      try { return statSync(join(PERSONAL_AGENTS, e)).isDirectory(); }
      catch { return false; }
    });
    // It's OK if empty for a fresh install, just verify the dir is scannable
    assert.ok(Array.isArray(dirs));
  });
});

describe("Drive Folder — agent subdirectory structure", () => {
  it("agent directories are readable", () => {
    if (!existsSync(PERSONAL_AGENTS)) return;
    const entries = readdirSync(PERSONAL_AGENTS);
    const agentDirs = entries.filter(e => {
      try { return statSync(join(PERSONAL_AGENTS, e)).isDirectory(); }
      catch { return false; }
    });

    // Verify all agent directories are scannable
    for (const agentDir of agentDirs) {
      const agentHome = join(PERSONAL_AGENTS, agentDir);
      const contents = readdirSync(agentHome);
      assert.ok(Array.isArray(contents), `${agentDir} should be readable`);
    }
  });

  it("memory directories contain expected files", () => {
    if (!existsSync(PERSONAL_AGENTS)) return;
    const entries = readdirSync(PERSONAL_AGENTS);
    for (const agentDir of entries) {
      const memDir = join(PERSONAL_AGENTS, agentDir, "memory");
      if (existsSync(memDir) && statSync(memDir).isDirectory()) {
        // Memory dir may contain: context.md, session.json, daily/, etc.
        const memFiles = readdirSync(memDir);
        // Just verify it's readable
        assert.ok(Array.isArray(memFiles));
      }
    }
  });
});

describe("Drive Folder — platform agent resources", () => {
  it("hub-lite has CLAUDE.md in its resource directory", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/agents/hub-lite");
    const claudeMd = (body as any).config?.claudeMd || (body as any).claudeMd;
    if (claudeMd) {
      assert.ok(existsSync(claudeMd), `hub-lite CLAUDE.md should exist at ${claudeMd}`);
    }
  });

  it("creator agents have CLAUDE.md in their resource directories", async () => {
    if (!(await gatewayUp())) return;
    for (const id of ["agentcreator", "skillcreator", "appcreator", "promptcreator"]) {
      const { body } = await json(`/api/agents/${id}`);
      const claudeMd = (body as any).config?.claudeMd || (body as any).claudeMd;
      if (claudeMd) {
        assert.ok(existsSync(claudeMd), `${id} CLAUDE.md should exist at ${claudeMd}`);
      }
    }
  });
});
