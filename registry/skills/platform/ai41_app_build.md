---
name: ai41_app_build
description: >-
  Full app build lifecycle: scaffold, plan, build, verify, preview, deploy, register. Single runbook for building and shipping a production full-stack app (Express 5 + React 19 + Prisma + Tailwind + shadcn/ui) to Railway. Use when a user asks to build or create an app.
allowed-tools: Read Write Edit Glob Grep Bash WebFetch
---

# App Build — Full Lifecycle Runbook

One skill. Full pipeline. Scaffold → Plan → Build → Verify → Preview → Deploy → Register.

**Arguments:** User message describes the app. Extract name and features from it.

If the user specifies a **project directory**, use it as `{PROJECT_DIR}`. Otherwise default to `{PROJECT_DIR}/`.

If no description provided, ask: "What should this app do, and who is it for?"

---

## Key Paths

| Resource | Path |
|----------|------|
| Apps workspace | `{PROJECT_DIR}` (user-specified or `{PROJECT_DIR}/`) |
| Build checklist | `{PROJECT_DIR}/BUILD_CHECKLIST.md` |

---

## MANDATORY: Build Checklist

**At the START, create `{PROJECT_DIR}/BUILD_CHECKLIST.md` using this template.** Update it after every phase — check boxes off as you go.

```markdown
# App Build Checklist — {APP_NAME}

## App Info
- **Slug:** {APP_SLUG}
- **Needs DB:** {yes/no}
- **Needs Auth:** {yes/no}
- **Deploy URL:** (fill after deploy)
- **GitHub Repo:** (fill after deploy)
- **Started:** {DATE}

## Phase 1: Scaffold
- [ ] Directory structure created
- [ ] backend/package.json written
- [ ] backend/tsconfig.json written
- [ ] backend/.env written
- [ ] backend/prisma/schema.prisma written (if DB)
- [ ] backend/src/index.ts written
- [ ] frontend/package.json written
- [ ] frontend/tsconfig.json written
- [ ] frontend/vite.config.ts written
- [ ] frontend/src/main.tsx written
- [ ] frontend/src/App.tsx written
- [ ] frontend/src/lib/api.ts written
- [ ] frontend/src/lib/utils.ts written
- [ ] frontend/index.html written
- [ ] frontend/components.json written
- [ ] npm install succeeded (backend)
- [ ] npm install succeeded (frontend)
- [ ] shadcn base components installed

## Phase 2: Plan
- [ ] Prisma models identified
- [ ] API routes listed
- [ ] Frontend pages listed
- [ ] Plan outputted to user

## Phase 3: Build
- [ ] prisma/schema.prisma updated with models
- [ ] backend routes written
- [ ] backend middleware written
- [ ] backend routes registered in index.ts
- [ ] frontend pages written
- [ ] frontend components written
- [ ] frontend App.tsx router updated
- [ ] frontend api.ts covers all endpoints
- [ ] development-log.md created

## Phase 4: Verify
- [ ] prisma generate passes
- [ ] prisma db push passes (or skipped — no local DB)
- [ ] backend tsc --noEmit passes
- [ ] frontend tsc -b passes
- [ ] frontend vite build passes
- [ ] Developer agent created via create_agent MCP
- [ ] App registered as draft via create_app MCP

## Phase 5: Preview
- [ ] Backend running on port 3001
- [ ] Frontend running on port 5173
- [ ] User notified of preview URLs and developer agent
- [ ] User confirmed deploy (or requested changes)

## Phase 6: Deploy
- [ ] Git initialized and committed
- [ ] GitHub repo created
- [ ] Railway project initialized
- [ ] PostgreSQL provisioned (if DB)
- [ ] Backend deployed
- [ ] Frontend served (static or separate)
- [ ] Railway domain generated
- [ ] Health check passes at /api/health
- [ ] Prisma migrations run on Railway (if DB)

## Phase 7: Finalize
- [ ] App status updated to live via update_app MCP
- [ ] Developer agent heartbeat updated
- [ ] development-log.md updated with deploy info
- [ ] User given final report
```

---

## Before Starting

1. Parse the user's request. Identify:
   - `APP_NAME` — human readable (e.g., `Month-End Close Tracker`)
   - `APP_SLUG` — lowercase hyphenated (e.g., `month-end-close-tracker`)
   - `APP_DIR` — `{PROJECT_DIR}`
   - `NEEDS_DB` — default YES unless it's clearly a static/display-only app
   - `NEEDS_AUTH` — YES if user mentions login, users, accounts, roles
   - Sub-patterns needed (see table below)

2. Create the `BUILD_CHECKLIST.md` file now.

3. Confirm the plan with the user in 2-3 sentences:
   > "I'll build {APP_NAME} with {features}. Stack: Express 5 + React 19 + Prisma + PostgreSQL + Tailwind + shadcn/ui. Starting scaffold now."

4. Then go silent and execute all phases. Announce each phase as you enter it.

### Sub-Pattern Selection

| If user mentions... | Pattern to apply during Build |
|---------------------|-------------------------------|
| login, users, accounts, auth | JWT auth middleware + User model |
| orgs, teams, multi-tenant | Tenant model + scoped queries |
| AI, chat, embeddings | Streaming route + OpenAI client |
| billing, payments | Stripe webhook route + Payment model |
| charts, analytics, dashboard | Recharts + aggregation queries |
| real-time, live updates | SSE or WebSocket route |
| file upload, documents | Multer + S3/local storage route |
| email, notifications | Nodemailer or Resend integration |

---

## Phase 1: SCAFFOLD

Tell the user: **"Phase 1/7: Scaffolding project..."**

### Directory Structure

```bash
mkdir -p {PROJECT_DIR}/backend/src/routes
mkdir -p {PROJECT_DIR}/backend/src/middleware
mkdir -p {PROJECT_DIR}/backend/src/lib
mkdir -p {PROJECT_DIR}/backend/prisma
mkdir -p {PROJECT_DIR}/frontend/src/components/ui
mkdir -p {PROJECT_DIR}/frontend/src/components/layout
mkdir -p {PROJECT_DIR}/frontend/src/pages
mkdir -p {PROJECT_DIR}/frontend/src/hooks
mkdir -p {PROJECT_DIR}/frontend/src/lib
mkdir -p {PROJECT_DIR}/frontend/public
```

### `.gitignore` (at project root)
```
node_modules/
dist/
build/
.env
.env.local
*.log
.prisma/
```

### `backend/package.json`
```json
{
  "name": "{APP_SLUG}-backend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev",
    "db:seed": "tsx prisma/seed.ts",
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "@prisma/client": "^6.2.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^5.0.1",
    "helmet": "^8.0.0",
    "morgan": "^1.10.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/morgan": "^1.9.9",
    "@types/node": "^22.10.0",
    "prisma": "^6.2.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

### `backend/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `backend/.env`
```
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/{APP_SLUG}?schema=public
NODE_ENV=development
```

### `backend/prisma/schema.prisma`
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Models added in Phase 3
```

### `backend/src/lib/prisma.ts`
```typescript
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query"] : ["error"],
});
```

### `backend/src/index.ts`
```typescript
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

const app = express();
const PORT = parseInt(process.env.PORT || "3001");

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(morgan("dev"));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes registered in Phase 3

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

### `frontend/package.json`
```json
{
  "name": "{APP_SLUG}-frontend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.468.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.1.0",
    "tailwind-merge": "^2.6.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

### `frontend/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### `frontend/tsconfig.node.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["vite.config.ts"]
}
```

### `frontend/vite.config.ts`
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true } },
  },
});
```

### `frontend/index.html`
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{APP_NAME}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `frontend/components.json`
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/index.css", "baseColor": "zinc", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" },
  "iconLibrary": "lucide"
}
```

### `frontend/src/index.css`
```css
@import "tailwindcss";
```

### `frontend/src/main.tsx`
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>
);
```

### `frontend/src/App.tsx`
```tsx
import { Routes, Route } from "react-router-dom";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        <Route path="/" element={<div className="p-8 text-center text-muted-foreground">Building...</div>} />
      </Routes>
    </div>
  );
}
```

### `frontend/src/lib/utils.ts`
```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

### `frontend/src/lib/api.ts`
```typescript
const BASE_URL = "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || res.statusText);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
```

### Install Dependencies

```bash
cd {PROJECT_DIR}/backend && npm install
cd {PROJECT_DIR}/frontend && npm install
cd {PROJECT_DIR}/frontend && npx shadcn@latest add button card input label --yes 2>/dev/null || true
```

### Verify Scaffold
```bash
test -f {PROJECT_DIR}/backend/node_modules/.package-lock.json && echo "backend: OK" || echo "backend: FAILED"
test -f {PROJECT_DIR}/frontend/node_modules/.package-lock.json && echo "frontend: OK" || echo "frontend: FAILED"
```

Both must say OK. If either fails, retry `npm install` once. Update checklist ✓.

---

## Phase 2: PLAN

Tell the user: **"Phase 2/7: Planning..."**

Analyze the request and output a numbered plan (10 items max):
1. Prisma models with key fields
2. API routes (method + path)
3. Frontend pages
4. Auth approach if needed

Output this plan to the user. Do NOT wait for approval — immediately proceed to Phase 3.

Update checklist ✓.

---

## Phase 3: BUILD

Tell the user: **"Phase 3/7: Building..."**

### Architecture Rules

**Project structure:**
```
backend/src/
  index.ts          — registers middleware + all routes
  routes/
    health.ts       — GET /api/health
    {domain}.ts     — one file per domain
    index.ts        — re-exports registerRoutes()
  middleware/
    errorHandler.ts — global error handler
    validate.ts     — zod validation helper
  lib/
    prisma.ts       — prisma singleton
```

**Route file pattern:**
```typescript
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";

const router = Router();

const CreateSchema = z.object({ name: z.string().min(1), ... });

router.get("/", async (_req, res) => {
  const items = await prisma.model.findMany({ orderBy: { createdAt: "desc" } });
  res.json(items);
});

router.post("/", async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const item = await prisma.model.create({ data: parsed.data });
  res.status(201).json(item);
});

export default router;
```

**Route registration (`src/routes/index.ts`):**
```typescript
import type { Express } from "express";
import health from "./health.js";
import items from "./items.js";

export function registerRoutes(app: Express) {
  app.use("/api/health", health);
  app.use("/api/items", items);
}
```

**Then update `src/index.ts` to call `registerRoutes(app)`.**

**Prisma conventions:**
- `id String @id @default(cuid())`
- Always include `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt`
- Optional fields: `String?` not separate null checks
- Validate with Zod at route level, never trust raw `req.body`

**Frontend page pattern:**
```tsx
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Item[]>("/items").then(setItems).finally(() => setLoading(false));
  }, []);

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">{Title}</h1>
      </div>
      {loading ? (
        <div className="text-center text-muted-foreground py-12">Loading...</div>
      ) : (
        <div className="grid gap-4">
          {items.map(item => (
            <Card key={item.id}>
              <CardContent className="p-4">{/* item content */}</CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Styling rules:**
- Tailwind only — no custom CSS
- `cn()` for conditional classes
- shadcn/ui for ALL interactive elements (buttons, inputs, cards, tables, dialogs, selects)
- Install additional shadcn components as needed: `npx shadcn@latest add {component} --yes`
- Responsive grids: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`

### Build Order

**Backend:**
1. `prisma/schema.prisma` — add all models
2. `src/lib/prisma.ts` — already written
3. `src/routes/{domain}.ts` — one per domain
4. `src/routes/index.ts` — registerRoutes
5. `src/index.ts` — call registerRoutes
6. `src/middleware/errorHandler.ts` if complex

**Frontend:**
1. Install any extra shadcn components needed
2. `src/components/layout/Navbar.tsx`
3. `src/pages/*.tsx` — one per page
4. `src/hooks/use{Domain}.ts` — if shared data fetching logic
5. `src/App.tsx` — update router with all pages
6. `src/lib/api.ts` — already has base, add typed helpers if needed

Write complete, production-quality code — no stubs, no TODOs, no `as any`.

### Create `development-log.md`

At the end of the build phase, write `{PROJECT_DIR}/development-log.md`:

```markdown
# {APP_NAME} — Development Log

## Build Record
- **Created:** {DATE}
- **Requested by:** Web UI user
- **Built by:** @appcreator

## Original Request
{paste the user's original description here}

## Tech Stack
- Express 5 + React 19 + Vite + TypeScript
- Prisma + PostgreSQL (if DB)
- Tailwind CSS + shadcn/ui

## What Was Built

### Database Models
{list each Prisma model with key fields}

### API Routes
{list each route: METHOD /api/path — description}

### Frontend Pages
{list each page component and what it shows}

### Key Decisions
{any non-obvious choices made during build — e.g., "Used SSE for live updates instead of WebSocket because..."}

## Build Status
- Scaffold: ✓
- Build: ✓
- Verify: pending
- Preview: pending
- Deploy: pending
- Register: pending

## Change History
{append entries here as changes are made}
```

This file is the **handoff document** — when the developer agent takes over, it reads this file to understand the full context of the app. Always append to the Change History section when making modifications.

Update checklist ✓.

---

## Phase 4: VERIFY

Tell the user: **"Phase 4/7: Verifying builds..."**

Run these IN ORDER. Fix errors before moving to next step.

### Step 1: Prisma Generate
```bash
cd {PROJECT_DIR}/backend && npx prisma generate 2>&1
```
Fix schema errors if any. Max 5 retries.

### Step 2: Prisma DB Push
```bash
cd {PROJECT_DIR}/backend && npx prisma db push --accept-data-loss 2>&1
```
If "connection refused" or no local DB — skip this step. DB will be created on Railway.

### Step 3: Backend TypeScript
```bash
cd {PROJECT_DIR}/backend && npx tsc --noEmit 2>&1
```
Fix ONE error at a time from the top — TypeScript errors cascade. Max 5 retries.

### Step 4: Frontend TypeScript
```bash
cd {PROJECT_DIR}/frontend && npx tsc -b 2>&1
```
Fix errors. Max 5 retries.

### Step 5: Frontend Build
```bash
cd {PROJECT_DIR}/frontend && npx vite build 2>&1
```
Fix import errors. Max 3 retries.

**Error fix strategy:**
1. Read the full error — don't guess from line 1
2. Read the file at the line number mentioned
3. Make the minimal fix — don't rewrite, just fix the specific issue
4. Re-run to verify

Never: add `// @ts-ignore`, use `as any`, delete files, or comment out code to suppress errors.

When all 5 steps pass clean, proceed to create the developer agent.

### Step 6: Create Developer Agent

The app has passed verification — create its dedicated agent now so it owns the app from this point forward.

Use the `create_agent` MCP tool:
```json
{
  "agentId": "{APP_SLUG}-dev",
  "name": "{APP_NAME} Developer",
  "description": "Develops and maintains {APP_NAME}",
  "workspace": "{PROJECT_DIR}",
  "persistent": true,
  "streaming": true,
  "tools": ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
  "mcps": ["myaiforone"],
  "agentClass": "builder",
  "instructions": "# {APP_NAME} Developer\n\nYou maintain and develop {APP_NAME}.\n\n## First Thing\nRead `development-log.md` in your workspace to understand the app's architecture, what was built, and the full build history.\n\n## Your Workspace\n`{PROJECT_DIR}/`\n\n## Key Files\n- `development-log.md` — build history and architecture (READ THIS FIRST)\n- `BUILD_CHECKLIST.md` — build phase tracking\n- `backend/` — Express 5 API\n- `frontend/` — React 19 + Vite\n\n## Rules\n- Always update `development-log.md` Change History when you make changes\n- Use shadcn/ui for ALL UI components\n- Run `npx tsc --noEmit` after backend changes to verify\n- Run `npm run build` after frontend changes to verify"
}
```

### Step 7: Register App as Draft

Use the `create_app` MCP tool:
```json
{
  "name": "{APP_NAME}",
  "category": "{best matching: finance|productivity|engineering|operations|infrastructure|devtools|analytics}",
  "status": "draft",
  "agentDeveloper": "{APP_SLUG}-dev",
  "provider": "me",
  "otherDetails": "Workspace: {PROJECT_DIR}"
}
```

Update `development-log.md` — set Verify to ✓, note the developer agent was created.

Update checklist ✓.

---

## Phase 5: PREVIEW

Tell the user: **"Phase 5/7: Starting preview servers..."**

```bash
cd {PROJECT_DIR}/backend && npm run dev &
cd {PROJECT_DIR}/frontend && npm run dev &
sleep 4
curl -s http://localhost:3001/api/health
```

Report to user:
```
Preview ready!

Frontend: http://localhost:5173
Backend API: http://localhost:3001

Developer agent: @{APP_SLUG}-dev (assigned to this app)
Status: draft (registered in platform)

Review the app. When you're happy, say "deploy" and I'll push to Railway.
If you want changes, describe them and I'll update the code.
Going forward, you can also chat with @{APP_SLUG}-dev to modify this app.
```

**STOP HERE and wait for user response.**
- "deploy" / "looks good" / "ship it" → Phase 6
- Change request → back to Phase 3 (edit existing files, don't rewrite)

Update checklist ✓.

---

## Phase 6: DEPLOY

Tell the user: **"Phase 6/7: Deploying to Railway..."**

### Step 1: Git
```bash
cd {PROJECT_DIR}
git init
git add -A
git commit -m "Initial commit: {APP_NAME}"
```

### Step 2: GitHub
```bash
gh repo create agenticledger/{APP_SLUG} --private --source=. --push
```
If org fails: `gh repo create {APP_SLUG} --private --source=. --push`

### Step 3: Serve Frontend from Backend

Before deploying, consolidate into a single Railway service:

1. Build frontend: `cd {PROJECT_DIR}/frontend && npm run build`
2. Copy dist: `cp -r {PROJECT_DIR}/frontend/dist {PROJECT_DIR}/backend/public`
3. Add to `backend/src/index.ts` (after routes, before error handler):
```typescript
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, "../public")));
app.get("*", (_req, res) => res.sendFile(join(__dirname, "../public/index.html")));
```
4. Commit: `git add -A && git commit -m "Serve frontend from backend"`
5. Push: `git push`

### Step 4: Railway
```bash
cd {PROJECT_DIR}/backend
railway init --name {APP_SLUG}
railway add --database postgres
railway variables set PORT=3001 NODE_ENV=production
railway up --detach
```

### Step 5: Get URL and Verify
```bash
railway domain
sleep 15
curl -s https://{RAILWAY_URL}/api/health
```

If health fails, check logs: `railway logs --tail 50`. Fix, push, wait, recheck. Max 3 retries.

### Step 6: Run Migrations
```bash
railway run npx prisma db push
```

Update BUILD_CHECKLIST.md with deploy URL and GitHub repo. Update checklist ✓.

---

## Phase 7: FINALIZE

Tell the user: **"Phase 7/7: Finalizing registration..."**

### Step 1: Update App to Live
Use the `update_app` MCP tool to set the deployed URL and status:
```json
{
  "id": "{APP_SLUG}",
  "url": "{DEPLOY_URL}",
  "status": "live",
  "githubRepo": "{GITHUB_URL}",
  "githubBranch": "main",
  "deployPlatform": "railway"
}
```

### Step 2: Update Developer Agent Heartbeat
Use the `update_agent` MCP tool to add health monitoring now that a deploy URL exists:
```json
{
  "agentId": "{APP_SLUG}-dev",
  "heartbeatInstructions": "Check Railway health at {DEPLOY_URL}/api/health. If unhealthy, investigate logs, fix code, commit, and push to trigger redeploy."
}
```

### Step 3: Update Development Log
Append to `development-log.md`:
```
## Deployment
- **URL:** {DEPLOY_URL}
- **GitHub:** {GITHUB_URL}
- **Railway project:** {APP_SLUG}
- **Deployed:** {DATE}
- **Status:** live
```

### Step 4: Final Report

```
Your app is live!

App:     {APP_NAME}
URL:     {DEPLOY_URL}
GitHub:  {GITHUB_URL}
Status:  live (visible in Registry at /marketplace)

Developer agent: @{APP_SLUG}-dev
  Chat with this agent to make changes, redeploy, or maintain the app.

Build log: {PROJECT_DIR}/development-log.md
```

Update checklist ✓. Done.
