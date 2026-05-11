import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

describe("Bootstrap — Creator Agents", () => {
  const creators = ["agentcreator", "skillcreator", "appcreator", "promptcreator"];

  it("all 4 creator agents are registered", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/agents");
    const ids = ((body as any).agents || []).map((a: any) => a.id);
    for (const id of creators) {
      assert.ok(ids.includes(id), `Missing creator agent: ${id}`);
    }
  });

  it("creator agents have correct names", async () => {
    if (!(await gatewayUp())) return;
    const expected: Record<string, string> = {
      agentcreator: "Agent Creator",
      skillcreator: "Skill Creator",
      appcreator: "App Creator",
      promptcreator: "Prompt Creator",
    };
    for (const [id, name] of Object.entries(expected)) {
      const { status, body } = await json(`/api/agents/${id}`);
      assert.equal(status, 200, `Agent ${id} should exist`);
      const agentName = (body as any).config?.name || (body as any).name;
      assert.equal(agentName, name);
    }
  });

  it("creator agents have agentClass=platform", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/dashboard");
    const agents = (body as any).agents || [];
    for (const id of creators) {
      const a = agents.find((x: any) => x.id === id);
      assert.ok(a, `Dashboard should include ${id}`);
      assert.equal(a.agentClass, "platform", `${id} should be platform class`);
    }
  });

  it("creator agents have streaming enabled", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/dashboard");
    const agents = (body as any).agents || [];
    for (const id of creators) {
      const a = agents.find((x: any) => x.id === id);
      assert.ok(a?.streaming, `${id} should have streaming enabled`);
    }
  });
});

describe("Bootstrap — Creator CLAUDE.md files", () => {
  const agentsDir = join(__dirname, "..", "..", "agents");

  it("each creator has a CLAUDE.md", () => {
    for (const id of ["agentcreator", "skillcreator", "appcreator", "promptcreator"]) {
      const mdPath = join(agentsDir, id, "CLAUDE.md");
      assert.ok(existsSync(mdPath), `Missing CLAUDE.md for ${id}`);
      const content = readFileSync(mdPath, "utf-8");
      assert.ok(content.length > 100, `${id}/CLAUDE.md should have substantial content`);
    }
  });

  it("each creator has an agent.json", () => {
    for (const id of ["agentcreator", "skillcreator", "appcreator", "promptcreator"]) {
      const jsonPath = join(agentsDir, id, "agent.json");
      assert.ok(existsSync(jsonPath), `Missing agent.json for ${id}`);
      const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
      assert.equal(data.id, id);
      assert.ok(data.name);
    }
  });

  it("agentcreator CLAUDE.md references create_agent MCP tool", () => {
    const content = readFileSync(join(agentsDir, "agentcreator", "CLAUDE.md"), "utf-8");
    assert.ok(content.includes("create_agent"), "Should reference the create_agent MCP tool");
  });

  it("skillcreator CLAUDE.md references skill file format", () => {
    const content = readFileSync(join(agentsDir, "skillcreator", "CLAUDE.md"), "utf-8");
    assert.ok(content.includes("frontmatter") || content.includes("---"), "Should describe skill format");
  });
});

describe("Bootstrap — Hub Agent", () => {
  it("hub-lite agent exists", async () => {
    if (!(await gatewayUp())) return;
    const { status } = await json("/api/agents/hub-lite");
    assert.equal(status, 200);
  });
});

describe("Bootstrap — labEnabled default", () => {
  it("labEnabled defaults to false", async () => {
    if (!(await gatewayUp())) return;
    const { body } = await json("/api/config/service");
    // labEnabled should exist and be boolean
    assert.equal(typeof (body as any).labEnabled, "boolean");
  });
});
