# MyAIforOne Lite

Lightweight version of MyAIforOne — one agent, one chat, full power.

## What Is Lite?

Lite gives users a single chat UI (`/ui`) with full agent capabilities:
- Claude CLI execution (tools: Read, Write, Bash, etc.)
- MCP server connections
- Skills
- Cron jobs (goals & schedules)
- Memory (basic + advanced vector search)
- Wiki learning

What Lite does NOT include:
- Channel drivers (Telegram, Slack, Discord, WhatsApp, iMessage)
- Boards, Gym, Projects, Library, Lab, Admin pages
- Templates, team gateways, shared agents
- Multi-page navigation

## Drive

Agent data lives in `~/Desktop/MyAIforOne Drive Lite/PersonalAgents/`.
Same folder structure as full MyAIforOne — upgrade is just copying files over.

## Running

```bash
npm install
npm run build
npm start
```

Open http://localhost:4888 — serves the chat UI directly.

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Web:** Express (single page: index.html)
- **Executor:** Spawns `claude -p` with system prompt, workspace, tools, MCPs
- **Config:** `config.json` (same schema as full MyAIforOne, fewer fields used)

## Relationship to Full MyAIforOne

This repo is a subset of `channelToAgentToClaude`. The agent engine, executor, config schema, and Drive structure are identical. Upgrading:

1. Install full MyAIforOne
2. Copy `~/Desktop/MyAIforOne Drive Lite/PersonalAgents/*` → `~/Desktop/MyAIforOne Drive/PersonalAgents/`
3. Agents, memory, skills, MCPs carry over untouched
