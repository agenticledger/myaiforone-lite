---
name: ai41_app_verify
description: >-
  Build verification loop for full-stack apps. Runs prisma generate, backend tsc, frontend vite build. Auto-reads errors and fixes code. Called by ai41_app_orchestrator Phase 4.
allowed-tools: Bash Read Edit
---

# App Verify

Run build verification in a loop. If anything fails, read the error, fix the code, and retry.

## Verification Order

Execute these steps IN ORDER. Each step must pass before moving to the next.

### Step 1: Prisma Generate (if database exists)

```bash
cd {APP_DIR}/backend && npx prisma generate
```

**If fails:**
- Read the error output
- Common fixes: missing model, invalid relation, syntax error in schema.prisma
- Fix `prisma/schema.prisma` using Edit tool
- Retry (max 5 times)

### Step 2: Prisma DB Push (if database exists)

```bash
cd {APP_DIR}/backend && npx prisma db push --accept-data-loss 2>&1
```

**If fails:**
- If "database does not exist" → create it: `createdb {APP_SLUG}` or adjust DATABASE_URL
- If schema conflict → the error usually says what's wrong, fix the schema
- If connection refused → database isn't running, report to user
- Retry (max 3 times)

**If no local PostgreSQL is available:** Skip this step. The database will be created on Railway during deploy. Use `npx prisma generate` only to ensure the Prisma client compiles.

### Step 3: Backend Build

```bash
cd {APP_DIR}/backend && npx tsc --noEmit 2>&1
```

**If fails:**
- Read the FULL error output
- TypeScript errors typically include file path and line number
- Common issues:
  - Missing imports → add the import
  - Type mismatches → fix the type annotation
  - Missing properties → add them to the interface or make optional
  - Cannot find module → check the import path
- Fix using Edit tool on the specific file
- Retry (max 5 times)

**IMPORTANT:** Fix one error at a time from the top. TypeScript errors cascade — fixing the first often resolves 3-4 others.

### Step 4: Frontend Build

```bash
cd {APP_DIR}/frontend && npx tsc -b 2>&1
```

Then:

```bash
cd {APP_DIR}/frontend && npx vite build 2>&1
```

**If tsc fails:**
- Same approach as backend — read error, fix file, retry
- Common frontend-specific issues:
  - Missing `"use client"` type issues → not relevant (this isn't Next.js)
  - JSX type errors → ensure proper React types imported
  - Component prop mismatches → fix the interface
- Retry (max 5 times)

**If vite build fails after tsc passes:**
- Usually a runtime import issue
- Read the error — it tells you the exact import that failed
- Fix the import path
- Retry (max 3 times)

### Step 5: Verification Complete

When all 4 steps pass clean:
1. Report: "All builds pass clean. Starting preview..."
2. Return to orchestrator for Phase 5 (Preview)

## Error Fix Strategy

When you encounter a TypeScript error:

1. **Read the full error** — don't guess from the first line
2. **Read the file** at the line number mentioned
3. **Understand the context** — is it a missing import, wrong type, or logic error?
4. **Make the minimal fix** — don't rewrite the file, just fix the specific issue
5. **Re-run the build** — verify the fix worked

Never:
- Delete a file to "fix" an error
- Comment out code to make errors go away
- Add `// @ts-ignore` or `as any` to suppress errors
- Rewrite large sections of code just because of one type error
