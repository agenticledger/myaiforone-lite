/**
 * Agent Registry — indexes agent descriptions for RAG-based delegation.
 * Used by group agents to find the right sub-agent for a user query.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppConfig } from "./config.js";
import { log } from "./logger.js";

interface AgentRegistryEntry {
  id: string;
  name: string;
  description: string;
  aliases: string[];
  mcps: string[];
  org: string;
  function: string;
  capabilities: string;
}

interface RegistryIndex {
  entries: AgentRegistryEntry[];
  updatedAt: string;
}

/**
 * Build a searchable text block for an agent (used for keyword/embedding matching).
 */
function buildAgentSearchText(id: string, agent: AppConfig["agents"][string]): string {
  const parts = [
    `Agent: ${agent.name} (${id})`,
    `Description: ${agent.description}`,
    `Aliases: ${(agent.mentionAliases || []).join(", ")}`,
  ];
  if (agent.mcps?.length) parts.push(`MCPs/Integrations: ${agent.mcps.join(", ")}`);
  if (agent.org?.length) {
    parts.push(`Organization: ${agent.org.map(o => `${o.organization} / ${o.function} / ${o.title}`).join("; ")}`);
  }
  if (agent.allowedTools?.length) parts.push(`Tools: ${agent.allowedTools.join(", ")}`);
  if (agent.goals?.length) {
    parts.push(`Goals: ${agent.goals.map(g => g.description).join("; ")}`);
  }

  // Try to read the CLAUDE.md for richer description
  try {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const claudeMdPath = agent.claudeMd.startsWith("~") ? agent.claudeMd.replace("~", home) : agent.claudeMd;
    if (existsSync(claudeMdPath)) {
      const claudeMd = readFileSync(claudeMdPath, "utf-8");
      // Extract just the first section (usually the main description)
      const firstSection = claudeMd.split("##")[0].trim();
      if (firstSection.length > 50 && firstSection.length < 2000) {
        parts.push(`Details: ${firstSection}`);
      }
    }
  } catch { /* ignore */ }

  return parts.join("\n");
}

/**
 * Build the registry for a group agent's sub-agents.
 */
export function buildAgentRegistry(
  config: AppConfig,
  subAgents: string[] | "*",
): AgentRegistryEntry[] {
  const agentIds = subAgents === "*"
    ? Object.keys(config.agents)
    : subAgents;

  return agentIds
    .filter(id => config.agents[id] && !config.agents[id].subAgents) // exclude other group agents
    .map(id => {
      const agent = config.agents[id];
      return {
        id,
        name: agent.name,
        description: agent.description,
        aliases: agent.mentionAliases || [],
        mcps: agent.mcps || [],
        org: agent.org?.[0]?.organization || "",
        function: agent.org?.[0]?.function || "",
        capabilities: buildAgentSearchText(id, agent),
      };
    });
}

/**
 * Simple keyword-based search against agent registry.
 * Returns top N matches ranked by keyword overlap.
 * Falls back to this when vector search isn't available.
 */
export function searchAgentRegistry(
  registry: AgentRegistryEntry[],
  query: string,
  topN: number = 5,
): AgentRegistryEntry[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  const scored = registry.map(entry => {
    const text = entry.capabilities.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (text.includes(word)) score++;
      // Bonus for name/description match
      if (entry.name.toLowerCase().includes(word)) score += 2;
      if (entry.description.toLowerCase().includes(word)) score += 2;
      // Bonus for MCP match
      if (entry.mcps.some(m => m.toLowerCase().includes(word))) score += 3;
    }
    return { entry, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(s => s.entry);
}

/**
 * Build the system prompt section for a group agent.
 * Includes the full registry table and delegation instructions.
 */
export function buildGroupAgentPrompt(
  registry: AgentRegistryEntry[],
  query: string,
  port: number = 4888,
): string {
  // Search for relevant agents
  const relevant = searchAgentRegistry(registry, query, 5);
  const allAgents = registry;

  const lines: string[] = [
    "\n\n## Sub-Agent Delegation",
    "You are a **group agent**. Your job is to understand the user's request and delegate to the right specialist agent. You can delegate to multiple agents in one conversation.",
    "",
    "### How to Delegate",
    "Use Bash to call the delegation API:",
    "```bash",
    `curl -s -X POST http://localhost:${port}/api/delegate \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"agentId":"<agent-id>","text":"<the user\\'s question or task>"}'`,
    "```",
    "The response JSON has `{ ok: true, agentId, response }`. Present the `response` to the user.",
    "",
    "### Guidelines",
    "- Pick the best agent based on their description, MCPs, and capabilities",
    "- You can delegate to multiple agents in sequence if the request spans multiple domains",
    "- If you're unsure which agent to use, pick the closest match — don't ask the user to choose",
    "- If no agent matches, answer the question yourself using your own knowledge",
    "- After getting a delegate's response, you can add context or synthesize across multiple responses",
    "- NEVER reveal the delegation mechanism to the user — present responses naturally",
    "",
  ];

  // Show relevant agents first (RAG results)
  if (relevant.length > 0) {
    lines.push("### Most Relevant Agents for This Query");
    lines.push("| Agent | Alias | Description | MCPs |");
    lines.push("|-------|-------|-------------|------|");
    for (const a of relevant) {
      lines.push(`| **${a.name}** | ${a.aliases[0] || a.id} | ${(a.description || "").slice(0, 100)} | ${(a.mcps || []).slice(0, 5).join(", ")} |`);
    }
    lines.push("");
  }

  // Full registry
  lines.push("### Full Agent Registry");
  lines.push("| ID | Name | Description | Org |");
  lines.push("|----|------|-------------|-----|");
  for (const a of allAgents) {
    lines.push(`| ${a.id} | ${a.name} | ${(a.description || "").slice(0, 80)} | ${a.org || ""} |`);
  }
  lines.push("");

  return lines.join("\n");
}
