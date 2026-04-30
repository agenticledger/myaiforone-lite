---
name: ai41_app_patterns
description: >-
  Architecture patterns and coding conventions for building full-stack Express + React apps. Extracted from production apps (P&L Analyzer, EscrowService). Called by ai41_app_orchestrator Phase 3.
allowed-tools: Read Write Edit
---

# App Patterns

These are the architecture patterns to follow when building apps. They are extracted from production-quality apps and represent proven conventions. Follow them exactly.

## Project Structure

```
{app-slug}/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express app entry — registers middleware + routes
│   │   ├── routes/
│   │   │   ├── health.ts         # GET /api/health
│   │   │   ├── {domain}.ts       # One file per domain (expenses.ts, users.ts, etc.)
│   │   │   └── index.ts          # Re-exports all route registrations
│   │   ├── middleware/
│   │   │   ├── auth.ts           # Auth middleware (if needed)
│   │   │   ├── errorHandler.ts   # Global error handler
│   │   │   └── validate.ts       # Zod validation middleware
│   │   └── lib/
│   │       └── prisma.ts         # Prisma client singleton
│   ├── prisma/
│   │   ├── schema.prisma         # Database schema
│   │   └── seed.ts               # Seed data
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Router
│   │   ├── main.tsx              # Entry point
│   │   ├── index.css             # Tailwind imports
│   │   ├── components/
│   │   │   ├── ui/               # shadcn/ui components
│   │   │   ├── layout/           # Layout components (Navbar, Sidebar, PageHeader)
│   │   │   └── {domain}/         # Domain components (ExpenseForm, ExpenseCard)
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx     # Main landing page
│   │   │   └── {Domain}Page.tsx  # One page per major view
│   │   ├── hooks/
│   │   │   └── use{Domain}.ts    # Custom hooks per domain
│   │   └── lib/
│   │       ├── api.ts            # API client (fetch wrapper)
│   │       └── utils.ts          # cn() helper for Tailwind
│   └── package.json
└── .gitignore
```

## Backend Conventions

### Express App Setup (`src/index.ts`)

```typescript
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { registerRoutes } from "./routes/index.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3001");

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(morgan("dev"));

// Register all routes
registerRoutes(app);

// Global error handler (must be LAST)
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

### Route Files (`src/routes/{domain}.ts`)

One file per domain. Each exports a `register` function:

```typescript
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";

const router = Router();

// Schema validation
const CreateExpenseSchema = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
  category: z.string().optional(),
});

// GET /api/expenses
router.get("/", async (_req, res) => {
  const expenses = await prisma.expense.findMany({
    orderBy: { createdAt: "desc" },
  });
  res.json(expenses);
});

// POST /api/expenses
router.post("/", async (req, res) => {
  const parsed = CreateExpenseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const expense = await prisma.expense.create({ data: parsed.data });
  res.status(201).json(expense);
});

// DELETE /api/expenses/:id
router.delete("/:id", async (req, res) => {
  await prisma.expense.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
```

### Route Registration (`src/routes/index.ts`)

```typescript
import type { Express } from "express";
import expenses from "./expenses.js";
import health from "./health.js";

export function registerRoutes(app: Express) {
  app.use("/api/health", health);
  app.use("/api/expenses", expenses);
}
```

### Prisma Client Singleton (`src/lib/prisma.ts`)

```typescript
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query"] : ["error"],
});
```

### Prisma Schema Conventions

```prisma
model Expense {
  id          String   @id @default(cuid())
  description String
  amount      Float
  category    String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations use camelCase field name, PascalCase model reference
  userId      String?
  user        User?    @relation(fields: [userId], references: [id])
}
```

**Conventions:**
- `id` is always `String @id @default(cuid())`
- Always include `createdAt DateTime @default(now())`
- Always include `updatedAt DateTime @updatedAt`
- Use `String?` for optional fields (not separate null checks)
- Relation fields: `userId String` + `user User @relation(...)`

### Zod Validation

Validate request bodies with Zod at the route level. Never trust client data:

```typescript
const schema = z.object({ ... });
const parsed = schema.safeParse(req.body);
if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
```

## Frontend Conventions

### Page Components (`src/pages/*.tsx`)

Each page is a self-contained view:

```tsx
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Expense[]>("/expenses")
      .then(setExpenses)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container mx-auto py-8 px-4">
      <PageHeader title="Expenses" description="Track your spending" />
      {loading ? (
        <div className="text-center text-muted-foreground py-12">Loading...</div>
      ) : (
        <div className="grid gap-4">
          {expenses.map(e => (
            <Card key={e.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{e.description}</p>
                  <p className="text-sm text-muted-foreground">{e.category}</p>
                </div>
                <p className="text-lg font-bold">${e.amount.toFixed(2)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Layout Components

**Navbar (`src/components/layout/Navbar.tsx`):**
```tsx
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Dashboard", path: "/" },
  { label: "Expenses", path: "/expenses" },
];

export function Navbar() {
  const { pathname } = useLocation();
  return (
    <nav className="border-b bg-white">
      <div className="container mx-auto flex h-14 items-center px-4 gap-6">
        <Link to="/" className="font-bold text-lg">{APP_NAME}</Link>
        {navItems.map(item => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "text-sm font-medium transition-colors hover:text-foreground",
              pathname === item.path ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
```

**PageHeader (`src/components/layout/PageHeader.tsx`):**
```tsx
export function PageHeader({ title, description, action }: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
```

### App Router (`src/App.tsx`)

```tsx
import { Routes, Route } from "react-router-dom";
import { Navbar } from "@/components/layout/Navbar";
import Dashboard from "@/pages/Dashboard";
import ExpensesPage from "@/pages/ExpensesPage";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/expenses" element={<ExpensesPage />} />
      </Routes>
    </div>
  );
}
```

### shadcn/ui Usage

ALWAYS use shadcn/ui components for UI elements. Install as needed during BUILD:

```bash
npx shadcn@latest add {component} --yes
```

Common components to install:
- `button` — always
- `card` — always
- `input` + `label` — for forms
- `table` — for data tables
- `dialog` — for modals
- `select` — for dropdowns
- `badge` — for status indicators
- `tabs` — for tabbed views
- `toast` + `sonner` — for notifications
- `dropdown-menu` — for action menus
- `separator` — for visual dividers

**Import pattern:**
```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
```

### Styling Rules

- Use Tailwind utility classes exclusively — no custom CSS
- Use `cn()` for conditional classes: `className={cn("base", condition && "variant")}`
- Spacing: `p-4` for card padding, `gap-4` for grid/flex gaps, `py-8 px-4` for page padding
- Container: `container mx-auto` for page-width content
- Colors: use Tailwind's semantic colors (`text-foreground`, `text-muted-foreground`, `bg-card`, `border`)
- Font: `font-bold` for headings, `font-medium` for labels, `text-sm` for secondary text
- Responsive: always include responsive breakpoints for grids (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`)

## General Rules

1. **No console.log in production code** — use `morgan` for request logging, `console.error` only for errors
2. **Always use TypeScript types** — define interfaces for API responses, component props, and database models
3. **API responses are always JSON** — `res.json(data)`, never raw text
4. **Error responses have consistent shape** — `{ error: string }` or `{ error: ZodFlattened }`
5. **Prisma models drive types** — import generated types from `@prisma/client`
6. **One route file per domain** — don't put all routes in index.ts
7. **One page component per major view** — don't put all views in App.tsx
8. **Forms use controlled components** — `useState` for form state, not uncontrolled refs
