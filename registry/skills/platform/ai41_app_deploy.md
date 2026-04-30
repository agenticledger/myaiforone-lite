---
name: ai41_app_deploy
description: >-
  Deploy a full-stack app to Railway via CLI. Handles git init, GitHub repo creation, Railway project setup, database provisioning, and health verification. Called by ai41_app_orchestrator Phase 6.
allowed-tools: Bash Read Edit
---

# App Deploy

Deploy the built app to Railway. This skill handles the full pipeline from local code to live URL.

## Prerequisites
- App has passed all verify checks (ai41_app_verify)
- Railway CLI is installed (`railway` command available)
- GitHub CLI is installed (`gh` command available)
- User has confirmed they want to deploy

## Step 1: Git Initialize

```bash
cd {APP_DIR}
git init
git add -A
git commit -m "Initial commit: {APP_NAME}"
```

If git is already initialized, just add and commit:
```bash
cd {APP_DIR}
git add -A
git commit -m "Initial commit: {APP_NAME}" --allow-empty
```

## Step 2: Create GitHub Repository

```bash
gh repo create agenticledger/{APP_SLUG} --private --source=. --push
```

**If `agenticledger` org fails:** try without org:
```bash
gh repo create {APP_SLUG} --private --source=. --push
```

Capture the repo URL for later use.

**If repo already exists:** just push:
```bash
git remote add origin https://github.com/agenticledger/{APP_SLUG}.git 2>/dev/null || true
git push -u origin main
```

## Step 3: Create Railway Project

```bash
cd {APP_DIR}
railway init --name {APP_SLUG}
```

This creates a new Railway project. Note the project ID.

## Step 4: Provision Database (if needed)

```bash
railway add --database postgres
```

This creates a PostgreSQL service in the Railway project. Railway automatically provides `DATABASE_URL` to linked services.

## Step 5: Deploy Backend

```bash
cd {APP_DIR}/backend
railway up --detach
```

Set environment variables:
```bash
railway variables set PORT=3001 NODE_ENV=production
```

If the app uses a database, Railway auto-injects `DATABASE_URL` from the Postgres service.

Wait for deployment to start, then check status:
```bash
railway status
```

## Step 6: Deploy Frontend

For the frontend, we need to build it and serve it. Two approaches:

**Option A: Deploy frontend as a separate Railway service**
```bash
cd {APP_DIR}/frontend
railway service create {APP_SLUG}-frontend
railway up --detach
```

**Option B: Serve frontend from backend (recommended for simplicity)**
Before deploying, modify `backend/src/index.ts` to serve the built frontend:

1. Build frontend: `cd {APP_DIR}/frontend && npm run build`
2. Copy dist to backend: `cp -r {APP_DIR}/frontend/dist {APP_DIR}/backend/public`
3. Add static serving to Express:
```typescript
// After routes, before error handler:
app.use(express.static("public"));
app.get("*", (_req, res) => {
  res.sendFile("index.html", { root: "public" });
});
```
4. Update backend's package.json build script to include frontend build
5. Redeploy backend

## Step 7: Generate Domain

```bash
railway domain
```

This generates a public URL like `https://{app-slug}.up.railway.app`.

Capture this URL — it's what the user gets.

## Step 8: Verify Deployment

```bash
curl -s https://{RAILWAY_URL}/api/health | head -20
```

Should return `{"status":"ok","timestamp":"..."}`.

**If health check fails:**
1. Check Railway logs:
```bash
railway logs --tail 50
```
2. Read the error
3. Common issues:
   - Missing env vars → `railway variables set KEY=VALUE`
   - Port binding → ensure backend uses `process.env.PORT`
   - Database connection → check `DATABASE_URL` is set
   - Build failure → check the build output in Railway dashboard
4. Fix the code locally, commit, push, Railway auto-redeploys
5. Wait and check again (max 3 retries)

## Step 9: Run Prisma Migrations on Railway (if database)

After deployment is healthy:
```bash
cd {APP_DIR}/backend
railway run npx prisma db push
```

Or if using migrations:
```bash
railway run npx prisma migrate deploy
```

## Output

When deployment is verified healthy, report:
- `deployUrl`: the Railway public URL
- `githubRepo`: the GitHub repo URL
- `railwayProject`: the Railway project name

Return to orchestrator for Phase 7 (Register).
