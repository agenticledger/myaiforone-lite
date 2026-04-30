---
name: ai41_app_orchestrator
description: >-
  Master orchestration runbook for building full-stack apps autonomously. Coordinates scaffold, build, verify, deploy, and register phases. Use when a user asks to build or create an app.
allowed-tools: Read Bash
---

# App Build Orchestrator

You are building a full-stack web application autonomously. Follow these phases IN ORDER. Do not skip phases. Check every exit criterion before advancing.

## Before Starting

1. Read the user's request carefully. Identify:
   - App name (derive a slug like `expense-tracker`)
   - Core features requested
   - Whether it needs a database (most apps do — default YES)
   - Whether it needs auth (look for mentions of users, login, accounts)
   - Whether it needs any sub-patterns (see Sub-Skill Selection below)
2. Confirm the plan with the user in 2-3 sentences: "I'll build {name} with {features}. Tech stack: Express 5 + React 19 + Prisma + PostgreSQL + Tailwind + shadcn/ui."
3. Then go silent and execute.

## Sub-Skill Selection

Based on the user's request, determine which sub-skills to apply DURING the Build phase:

| If user mentions... | Apply sub-skill |
|---------------------|----------------|
| login, users, accounts, auth | `ai41_app_pattern_auth` |
| orgs, tenants, teams, multi-tenant | `ai41_app_pattern_multitenant` |
| AI, chat, embeddings, agent | `ai41_app_pattern_ai_agent` |
| billing, payments, subscriptions | `ai41_app_pattern_payments` |
| charts, analytics, dashboard | `ai41_app_pattern_dashboard` |
| real-time, live updates, websocket | `ai41_app_pattern_realtime` |
| file upload, documents, images | `ai41_app_pattern_file_upload` |
| email, notifications | `ai41_app_pattern_email` |

If a sub-skill doesn't exist yet, apply the pattern using your best judgment based on the conventions in `ai41_app_patterns`.

---

## Phase 1: SCAFFOLD

### Entry Criteria
- User has described what they want
- You've confirmed the plan

### Actions
1. Read the `ai41_app_scaffold` skill
2. Follow it exactly — it creates the project directory and all config files deterministically
3. The workspace is `{PROJECT_DIR}/`

### Exit Checklist
- [ ] Directory `{PROJECT_DIR}/` exists
- [ ] `backend/package.json` exists with correct dependencies
- [ ] `frontend/package.json` exists with correct dependencies
- [ ] `backend/node_modules/` exists (npm install succeeded)
- [ ] `frontend/node_modules/` exists (npm install succeeded)
- [ ] `backend/prisma/schema.prisma` exists
- [ ] `backend/src/index.ts` exists
- [ ] `frontend/src/App.tsx` exists
- [ ] `.gitignore` exists at project root

### Max Retries: 2
### On Failure: Report to user — scaffold failed, likely a network issue with npm install.

---

## Phase 2: PLAN

### Entry Criteria
- Scaffold complete, all config files in place

### Actions
1. Analyze the user's request and produce a plan:
   - Database schema (Prisma models needed)
   - API routes (Express endpoints)
   - Frontend pages and components
   - Auth approach (if needed)
2. Output the plan to the user as a numbered list (10 points max)
3. Do NOT wait for approval — immediately proceed to Build

### Exit Checklist
- [ ] Plan outputted to chat
- [ ] You know what Prisma models to create
- [ ] You know what API routes to create
- [ ] You know what React pages/components to create

---

## Phase 3: BUILD

### Entry Criteria
- Plan complete

### Actions
1. Read the `ai41_app_patterns` skill for YOUR architecture conventions
2. Read any relevant sub-skills identified in Sub-Skill Selection
3. Write all application code:

**Backend (in order):**
   a. `prisma/schema.prisma` — add models
   b. `src/routes/` — create route files (one per domain)
   c. `src/middleware/` — auth, error handler, validation
   d. `src/index.ts` — register all routes
   e. `prisma/seed.ts` — seed data (if applicable)

**Frontend (in order):**
   a. `src/components/ui/` — shadcn/ui components needed
   b. `src/components/` — app-specific components
   c. `src/pages/` — page components
   d. `src/hooks/` — custom hooks (useApi, useAuth, etc.)
   e. `src/App.tsx` — router with all pages
   f. `src/lib/api.ts` — API client

4. Use the Write tool for new files, Edit tool for modifying scaffold files

### Exit Checklist
- [ ] Prisma schema has all models defined
- [ ] All API routes written with proper TypeScript types
- [ ] All React pages and components written
- [ ] API client (`src/lib/api.ts`) covers all endpoints
- [ ] Router in App.tsx includes all pages

---

## Phase 4: VERIFY

### Entry Criteria
- All application code written

### Actions
1. Read the `ai41_app_verify` skill
2. Follow its verification loop exactly
3. This phase may loop multiple times — that's expected

### Exit Checklist
- [ ] `npx prisma generate` succeeds
- [ ] `npx prisma migrate dev --name init` succeeds (or `npx prisma db push`)
- [ ] Backend `npm run build` (tsc) exits with code 0
- [ ] Frontend `npm run build` (vite build) exits with code 0
- [ ] No TypeScript errors

### Max Retries: 5 per step
### On Failure: After 5 retries on any step, report the error to user and ask for guidance.

---

## Phase 5: PREVIEW

### Entry Criteria
- All builds pass clean

### Actions
1. Start the backend dev server: `cd backend && npm run dev &`
2. Start the frontend dev server: `cd frontend && npm run dev &`
3. Wait 3 seconds for servers to start
4. Report to user:
   ```
   Preview ready!
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001

   Review the app in your browser. When you're happy, say "deploy" and I'll push it to Railway.
   If you want changes, describe them and I'll update the code.
   ```

### Exit Checklist
- [ ] Backend running on port 3001
- [ ] Frontend running on port 5173
- [ ] User notified of preview URLs

### IMPORTANT: STOP HERE and wait for user response.
- If user says "deploy" or similar → proceed to Phase 6
- If user requests changes → go back to Phase 3 (modify mode: edit existing files, don't rewrite everything)

---

## Phase 6: DEPLOY

### Entry Criteria
- User has confirmed they want to deploy

### Actions
1. Read the `ai41_app_deploy` skill
2. Follow it exactly — handles Git, GitHub, Railway
3. This phase may loop if Railway deployment has errors

### Exit Checklist
- [ ] Git repo initialized and committed
- [ ] GitHub repo created and code pushed
- [ ] Railway project created
- [ ] Database provisioned on Railway (if needed)
- [ ] Environment variables set
- [ ] Deployment healthy
- [ ] Public URL accessible

### Max Retries: 3 for deployment issues
### On Failure: Report Railway logs to user and ask for guidance.

---

## Phase 7: REGISTER

### Entry Criteria
- App deployed and accessible

### Actions
1. Read the `ai41_app_register` skill
2. Register the app in the platform
3. Create a developer agent for ongoing maintenance

### Exit Checklist
- [ ] App registered via `create_app` MCP tool
- [ ] Developer agent created via `create_agent` MCP tool
- [ ] User informed of: live URL, GitHub repo, developer agent alias

### Final Report to User
```
Your app is live!

- URL: https://{app-name}.up.railway.app
- GitHub: https://github.com/agenticledger/{repo-name}
- Developer agent: @{app-name}-dev (chat with this agent to make changes)

The developer agent has a heartbeat configured to monitor the app's health.
```

---

## Rules

- Never skip a phase
- Never skip exit criteria checks
- If a phase fails after max retries, STOP and ask the user — don't brute force
- Log your progress: at the start of each phase, tell the user which phase you're entering
- During BUILD, write complete, production-quality code — not stubs or TODOs
- Use shadcn/ui components for ALL UI elements (buttons, inputs, cards, tables, modals, dropdowns)
- Follow the patterns in `ai41_app_patterns` exactly — these are the owner's proven conventions
