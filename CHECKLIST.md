# MyAIforOne Lite — Build Checklist

> Delivery target: **Tauri desktop app** — user downloads a `.dmg` or `.exe`, double-clicks, and gets a native window with the chat UI. No terminal, no npm, no setup required.

---

## ✅ Core Engine (Done)

- [x] `src/executor.ts` — full Claude CLI executor (tools, MCPs, sessions, streaming)
- [x] `src/config.ts` — full config loader (same schema as full MyAIforOne)
- [x] `src/cron.ts` — scheduled messages / cron triggers
- [x] `src/goals.ts` — autonomous goals
- [x] `src/memory/` — basic + advanced vector memory
- [x] `src/wiki-sync.ts` — wiki learning
- [x] `src/heartbeat.ts` — agent heartbeats
- [x] `src/license.ts` — license check (non-blocking)
- [x] `src/keystore.ts` — encrypted key storage
- [x] `src/os-keychain.ts` — OS keychain integration
- [x] `src/anthropic-executor.ts` — direct Anthropic API executor
- [x] `src/openai-executor.ts` — OpenAI-compatible executor
- [x] `src/gemini-executor.ts` — Gemini executor
- [x] `src/ollama-executor.ts` — local Ollama executor
- [x] `src/agent-registry.ts` — agent registry loader
- [x] `src/mcp-http.ts` — MCP HTTP transport
- [x] `src/voice/` — voice providers (browser, grok)
- [x] `src/channels/types.ts` — channel type defs (no drivers shipped)

---

## ✅ Web UI — API Routes (Done)

All routes needed for the `/ui` chat page are present in `src/web-ui.ts`:

- [x] Auth — `/api/auth/login`, `/api/auth/status`
- [x] Agents — CRUD `/api/agents`, `/api/agents/:id`
- [x] Chat — `/api/chat/:agentId`, streaming, job stop, recover
- [x] Session tabs — create, rename, delete, history
- [x] Memory — read, write, search, clear context
- [x] MCP connections + keys
- [x] Goals + cron — CRUD, trigger, toggle, history
- [x] Automations list
- [x] Skills — content, list, marketplace install/assign
- [x] Cost + logs
- [x] Voice — TTS, STT, list voices, config
- [x] File upload/download
- [x] License check
- [x] Health endpoint

---

## ✅ Frontend Chat UI (Done)

- [x] `public/index.html` — single-page chat UI (agent list left, chat right)
- [x] Agent list sidebar — search, filter, create agent panel
- [x] Chat area — streaming responses, session tabs, typewriter effect
- [x] Voice input (STT) + TTS playback
- [x] File attachment upload
- [x] `public/auth.js` — API key / login auth
- [x] `public/canvas.js` / `canvas.css` — canvas artifact support
- [x] `public/mobile.css` — mobile-responsive styles
- [x] `public/license-check.js` — license gate UI
- [x] `public/server-mode.js` — server mode detection
- [x] Avatars (80 avatars included)

---

## ✅ Registry + Skills (Done)

- [x] `registry/skills.json` + skill files — full platform + external skills
- [x] `registry/mcps.json` — full MCP catalog
- [x] `registry/prompts.json` + prompt files
- [x] `registry/apps.json`
- [x] `mcp-catalog.json` — MCP definitions
- [x] `agents/_template/` — starter agent template

---

## ✅ MCP Server (Done)

- [x] `server/mcp-server/index.ts` — full MCP server (all tools)
- [x] `server/mcp-server/lib/api-client.ts` — HTTP API client

---

## ✅ UI Cleanup — Strip Full-App Nav (Done)

The lite `index.html` nav has been trimmed to essentials only:

- [x] Remove `/org` tab from nav bar
- [x] Remove `/library` tab from nav bar
- [x] Remove `/lab` tab from nav bar
- [x] Remove `/boards` button from nav bar
- [x] Remove `/admin` button from nav bar
- [x] Remove `sidebarOrgFilter` org dropdown (no org pages in Lite)
- [x] Remaining nav: logo + theme toggle only. Agent list sidebar + chat area intact.

---

## ✅ First-Run Onboarding (Done)

When the app launches for the first time (no agents in config):

- [x] Show a setup screen inside the WebView: "Welcome to MyAIforOne"
- [x] Step 1: Enter Anthropic API key — calls `POST /api/config/anthropic-key`, saves to `service.anthropicApiKey` in config.json and sets `ANTHROPIC_API_KEY` env var immediately
- [x] Step 2: Name your first agent — calls `POST /api/agents` with name/agentId/alias
- [x] Step 3: "You're all set!" — transitions to main chat UI
- [x] Skip if config already has agents (returning user)
- [x] `POST /api/config/anthropic-key` endpoint added to `src/web-ui.ts`

---

## ✅ Tauri Desktop App Scaffolded (Shell Ready — Binary Pending)

Tauri shell files are in place. Binary compile requires Bun (not yet installed locally — CI handles it).

### Tauri Shell
- [x] `src-tauri/Cargo.toml` — package metadata + tauri v2 + tauri-plugin-shell
- [x] `src-tauri/build.rs` — tauri_build::build()
- [x] `src-tauri/src/main.rs` — sidecar launch + 2s startup wait
- [x] `src-tauri/tauri.conf.json` — app name "MyAIforOne", identifier `ai.myaiforone.lite`, 1200×800 window, devUrl `http://localhost:4888`, externalBin sidecar
- [x] `src-tauri/capabilities/default.json` — core:default, shell:allow-open, shell:allow-execute
- [x] `src-tauri/icons/README.md` — icon placement instructions
- [x] `src-tauri/binaries/README.md` — binary build instructions (per-platform triple)
- [x] `package.json` updated: `"tauri": "tauri"` script + `@tauri-apps/cli ^2.0.0` devDep

### Node.js Sidecar (the backend)
- [x] Binary location: `src-tauri/binaries/myaiforone-server-<target-triple>` (CI builds these)
- [ ] Bun compile tested locally (Bun not installed — install `brew install bun` to test)
- [ ] Sidecar port fallback (4888 → free port) — deferred to v1.1

### Packaging
- [ ] macOS `.dmg` — produced by `tauri-action` in CI
- [ ] Windows `.exe` NSIS — produced by `tauri-action` in CI
- [ ] Linux `.AppImage` — optional, lower priority

### App Behavior
- [ ] Single instance enforcement — deferred to v1.1
- [ ] macOS tray / Windows tray — deferred to v1.1

---

## ✅ GitHub Actions CI (Done)

- [x] `.github/workflows/build.yml` — triggers on push to main + version tags
- [x] Build matrix: macOS arm64, macOS x64, Windows x64
- [x] Bun compiles server binary per platform before Tauri build
- [x] `tauri-apps/tauri-action@v0` publishes a draft GitHub Release with `.dmg` + `.exe`
- [ ] Code signing (macOS notarization, Windows Authenticode) — deferred, add secrets when ready

---

## ✅ README (Done)

- [x] `README.md` — user-facing: what it is, download table, requirements, getting started, upgrade path

---

## ⬜ Upgrade Path (Polish)

- [ ] Script or in-app button: "Upgrade to Full MyAIforOne" — opens download page
- [ ] Verify the copy-Drive-over upgrade works end to end (agents carry over untouched)

---

## Build Order

1. **Strip nav** — quick, 30-min job
2. **Onboarding screen** — needed before Tauri (it's just HTML/JS in index.html)
3. **Bun compile test** — make sure the server compiles to a single binary
4. **Tauri scaffold** — wrap the binary + webview
5. **CI** — automate builds
6. **README** — last, after screenshots are possible
