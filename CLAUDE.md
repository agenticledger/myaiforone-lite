# MyAIforOne Lite — Builder Agent

## My Role

I am the **engineer building and expanding myaiforone-lite**. My job is to implement features, fix bugs, extend the codebase, and ship the product. I work directly in this repo.

## Project

**myaiforone-lite** — a lightweight desktop AI chat app. One agent, one chat, full power.

- **Delivery target:** Tauri desktop app (`.dmg` / `.exe`) — no terminal, no setup, just download and run
- **Runtime:** Node.js + TypeScript + Express
- **Port:** 4889 (separate from full MyAIforOne on 4888)
- **Repo:** `/Users/oreph/Desktop/APPs/myaiforone-lite`

## Key Source Files

| File | Purpose |
|---|---|
| `src/index.ts` | App entrypoint — starts Express + all services |
| `src/web-ui.ts` | All API routes for the chat UI |
| `src/executor.ts` | Spawns `claude -p` with tools, MCPs, session |
| `src/config.ts` | Config loader (`config.json`) |
| `src/cron.ts` | Scheduled tasks |
| `src/goals.ts` | Autonomous goals |
| `src/memory/` | Basic + vector memory |
| `src/wiki-sync.ts` | Wiki learning |
| `public/index.html` | Chat UI (single page) |
| `public/lab.html` | Lab UI — conversational builder for agents/skills/apps/prompts |
| `public/org.html` | Agent management page |
| `public/settings.html` | Settings page (accounts, service config, features) |
| `agents/*/CLAUDE.md` | Creator agent instructions (agentcreator, skillcreator, etc.) |
| `src-tauri/` | Tauri desktop shell |
| `CHECKLIST.md` | Full build status — check this before starting work |

## Dev Commands

```bash
# Dev (hot reload)
npm run dev

# Build
npm run build

# Run built server
npm start

# Tauri desktop (requires binary in src-tauri/binaries/)
npm run tauri dev
npm run tauri build
```

## Build Status

All core items in `CHECKLIST.md` are complete:
- [x] macOS `.dmg` and Windows `.exe` packaging (CI via `tauri-action`)
- [x] macOS code signing + notarization (Developer ID Application cert + Apple notary)
- [ ] Windows code signing (deferred — requires OV/EV certificate)

## Architecture Notes

- The server is a Node.js sidecar inside the Tauri app — spawned by `src-tauri/src/main.rs`
- Claude CLI (`claude -p`) is the executor — it requires Node.js to be installed
- Drive folder: `~/Desktop/MyAIforOne Drive Lite/PersonalAgents/` — same schema as full MyAIforOne
- Upgrading to full MyAIforOne = just copying the Drive folder over
- Config lives in `config.json` (same schema as full MyAIforOne, fewer fields used)

## Lab Feature

Lab is a conversational builder for creating agents, skills, prompts, and apps. It includes:

- **4 creator agents** (bootstrapped as platform defaults): `agentcreator`, `skillcreator`, `appcreator`, `promptcreator`
- **CLAUDE.md files** in `agents/{creator}/CLAUDE.md` — use MCP tools (`create_agent`, `create_skill`, `create_prompt`, `create_app`, `assign_to_agents`)
- **Feature flag**: `labEnabled` in ServiceConfig — off by default, toggled in Settings > Features
- **Conditional nav tab**: Lab tab appears in Chat + Agents pages when enabled
- **Access guard**: `/lab` redirects to `/` if `labEnabled` is false
- **3 views**: Landing tiles → Intake form → Creation chat+canvas (split panel with streaming)
- **Streaming**: Uses same SSE pattern as main chat (`POST /api/chat/{agentId}/stream` → `GET /api/chat/jobs/{jobId}/stream`)

Creator agents use MCP tools (`create_agent`, `create_skill`, `create_prompt`, `create_app`, `assign_to_agents`, `update_agent`) backed by REST API endpoints on the Lite server.

## What Lite Does NOT Include

No channel drivers (Telegram, Slack, etc.), no Boards/Gym/Projects/Admin pages, no templates, no team gateways, no multi-agent routing, no AI Gym.
