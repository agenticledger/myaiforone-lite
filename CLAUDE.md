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

All core items in `CHECKLIST.md` are complete. Outstanding items:
- [ ] macOS `.dmg` and Windows `.exe` packaging (CI via `tauri-action`)
- [ ] Code signing (deferred)

## Architecture Notes

- The server is a Node.js sidecar inside the Tauri app — spawned by `src-tauri/src/main.rs`
- Claude CLI (`claude -p`) is the executor — it requires Node.js to be installed
- Drive folder: `~/Desktop/MyAIforOne Drive Lite/PersonalAgents/` — same schema as full MyAIforOne
- Upgrading to full MyAIforOne = just copying the Drive folder over
- Config lives in `config.json` (same schema as full MyAIforOne, fewer fields used)

## What Lite Does NOT Include

No channel drivers (Telegram, Slack, etc.), no Boards/Gym/Projects/Library/Lab/Admin pages, no templates, no team gateways, no multi-agent routing.
