---
name: ai41_app_scaffold
description: >-
  Deterministic project scaffolding for Express 5 + React 19 + Prisma + Tailwind + shadcn/ui apps. Creates all config files and runs npm install. Called by ai41_app_orchestrator Phase 1.
allowed-tools: Write Bash
---

# App Scaffold

Create the project directory and all configuration files deterministically. DO NOT let AI write these — use the exact templates below.

## Variables

Before starting, determine:
- `APP_SLUG` — lowercase hyphenated (e.g., `expense-tracker`)
- `APP_NAME` — human readable (e.g., `Expense Tracker`)
- `APP_DIR` — `{PROJECT_DIR}`
- `NEEDS_DB` — true/false (default: true)

## Step 1: Create Directory Structure

```bash
mkdir -p {PROJECT_DIR}/backend/src/routes
mkdir -p {PROJECT_DIR}/backend/src/middleware
mkdir -p {PROJECT_DIR}/backend/prisma
mkdir -p {PROJECT_DIR}/frontend/src/components/ui
mkdir -p {PROJECT_DIR}/frontend/src/pages
mkdir -p {PROJECT_DIR}/frontend/src/hooks
mkdir -p {PROJECT_DIR}/frontend/src/lib
mkdir -p {PROJECT_DIR}/frontend/public
```

## Step 2: Write Root Files

### `.gitignore`
```
node_modules/
dist/
build/
.env
.env.local
*.log
.prisma/
.next/
```

## Step 3: Write Backend Files

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
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

If `NEEDS_DB` is true, add to dependencies:
```json
    "@prisma/client": "^6.2.0"
```
And to devDependencies:
```json
    "prisma": "^6.2.0"
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
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `backend/.env.example`
```
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/{APP_SLUG}?schema=public
NODE_ENV=development
```

### `backend/.env`
```
PORT=3001
DATABASE_URL=postgresql://user:password@localhost:5432/{APP_SLUG}?schema=public
NODE_ENV=development
```

### `backend/prisma/schema.prisma` (if NEEDS_DB)
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Models will be added during BUILD phase
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

// Middleware
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(morgan("dev"));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes will be registered during BUILD phase

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

## Step 4: Write Frontend Files

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
    "paths": {
      "@/*": ["./src/*"]
    }
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
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
```

### `frontend/src/main.tsx`
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
```

### `frontend/src/index.css`
```css
@import "tailwindcss";
```

### `frontend/src/App.tsx`
```tsx
import { Routes, Route } from "react-router-dom";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        {/* Routes will be added during BUILD phase */}
        <Route path="/" element={<div className="p-8 text-center text-gray-500">App is scaffolded. Building...</div>} />
      </Routes>
    </div>
  );
}
```

### `frontend/src/lib/utils.ts`
```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
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

### `frontend/components.json` (shadcn/ui config)
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

### `frontend/index.html`
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{APP_NAME}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

## Step 5: Install Dependencies

```bash
cd {PROJECT_DIR}/backend && npm install
cd {PROJECT_DIR}/frontend && npm install
```

Wait for both to complete. If either fails, retry once.

## Step 6: Initialize shadcn/ui (install base components)

```bash
cd {PROJECT_DIR}/frontend && npx shadcn@latest add button card input label --yes 2>/dev/null || true
```

This installs the base shadcn/ui components. More will be added during BUILD as needed.

## Step 7: Verify Scaffold

Run these checks:
```bash
test -f {PROJECT_DIR}/backend/node_modules/.package-lock.json && echo "backend: OK" || echo "backend: FAILED"
test -f {PROJECT_DIR}/frontend/node_modules/.package-lock.json && echo "frontend: OK" || echo "frontend: FAILED"
test -f {PROJECT_DIR}/backend/prisma/schema.prisma && echo "prisma: OK" || echo "prisma: SKIPPED"
```

All must pass before proceeding to BUILD phase.
