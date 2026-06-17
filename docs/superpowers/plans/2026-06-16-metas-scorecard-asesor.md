# Metas y Scorecard por asesor (§5.14) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Metas mensuales por asesor/equipo/empresa sobre métricas de venta, con scorecard real-vs-meta donde el "real" se deriva de Deal/Activity/Quote/Contact (no se duplica).

**Architecture:** 1 modelo nuevo `Goal` (+2 enums). Capa server `src/server/goals.ts` deriva el real con `count`/`aggregate`. API REST estilo `/api/quotes`. Página `/metas` (admin/TL fija metas + scorecard; asesor read-only) + widget "mi avance del mes" en `/hoy`. Helpers puros testeados.

**Tech Stack:** Next.js 14.2 App Router, Prisma 6 + Supabase Postgres (esquema `propyte_crm`), date-fns, vitest. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-06-16-metas-scorecard-asesor-design.md`

**Rama:** crear `feat/crm-metas-scorecard` **apilada sobre `feat/crm-quickwins-contacto-deal-reunion`** (preserva el review local de lo anterior). Lo maneja el orquestador antes de Task 1.

**Hechos del repo verificados (citar, no re-descubrir):**
- Enums exactos: `DealStage.WON`, `ActivityStatus.COMPLETADA`, `QuoteStatus.SENT`, `Currency` = `MXN|USD`. Campo dinero: `Deal.estimatedValue` (`Decimal(14,2)`), `Deal.currency`, `Deal.actualCloseDate` (DateTime?, lo setea la transición a WON), `Deal.assignedToId`.
- `Activity`: `status`, `completedAt`, `userId`, `deletedAt`. `Quote`: `status`, `sentAt`, relación `deal` (con `assignedToId`), `deletedAt`. `Contact`: `createdAt`, `assignedToId`, `deletedAt`.
- `Team`/`TeamMember` existen: `TeamMember { teamId, userId, leftAt }`. Miembros activos = `leftAt: null`.
- RBAC inline (en rutas API): `const FULL_ACCESS_ROLES = ["ADMIN","DIRECTOR","GERENTE","DEVELOPER_EXT","MANTENIMIENTO"];` y `TEAM_ACCESS_ROLES = ["ADMIN","TEAM_LEADER"]`.
- Auth: `import { getServerSession } from "@/lib/auth/session"`; `session.user.id`, `session.user.role`. `params` SÍNCRONO en rutas dinámicas.
- `/hoy`: `src/app/(dashboard)/hoy/page.tsx` (server) llama `getTodayView(session.user.id, session.user.role)` de `src/server/today.ts` (`"use server"`).
- Multi-schema: todo modelo/enum nuevo lleva `@@schema("propyte_crm")` + `@@map(...)`. `date-fns` disponible (`addMonths`).
- **Gotcha:** `@@unique` con columnas nullable NO garantiza unicidad en Postgres (NULLs distintos) → el upsert se hace con findFirst manual, no `prisma.goal.upsert`.

---

### Task 1: Schema Prisma (Goal + enums) + SQL migración (additivo, NO aplicado)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations-manual/2026-06-16-goals.sql`

- [ ] **Step 1: Agregar enums + modelo** al final del bloque de modelos de `prisma/schema.prisma`:

```prisma
enum GoalScope {
  USER
  TEAM
  COMPANY

  @@schema("propyte_crm")
}

enum GoalMetric {
  CAPTACIONES
  NEGOCIOS_CREADOS
  COTIZACIONES_ENVIADAS
  ACTIVIDADES_COMPLETADAS
  NEGOCIOS_GANADOS
  MONTO_VENTA

  @@schema("propyte_crm")
}

// Metas mensuales por asesor/equipo/empresa (§5.14). El "real" se DERIVA, no se guarda.
model Goal {
  id          String     @id @default(uuid())
  scope       GoalScope
  userId      String?
  user        User?      @relation("UserGoals", fields: [userId], references: [id])
  teamId      String?
  team        Team?      @relation(fields: [teamId], references: [id])
  period      DateTime
  metric      GoalMetric
  target      Decimal    @db.Decimal(14, 2)
  currency    Currency?
  createdById String
  createdBy   User       @relation("GoalsCreated", fields: [createdById], references: [id])
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  deletedAt   DateTime?

  @@unique([scope, userId, teamId, period, metric, currency])
  @@index([period])
  @@index([userId])
  @@index([teamId])
  @@map("goals")
  @@schema("propyte_crm")
}
```

- [ ] **Step 2: Relaciones inversas.** En `model User { ... }` (junto a las otras relaciones nombradas):
```prisma
  goals        Goal[] @relation("UserGoals")
  goalsCreated Goal[] @relation("GoalsCreated")
```
En `model Team { ... }`:
```prisma
  goals Goal[]
```

- [ ] **Step 3: SQL de migración** `prisma/migrations-manual/2026-06-16-goals.sql`:

```sql
-- Metas/Scorecard (§5.14) — additivo, idempotente. NO toca tablas existentes.
-- Aplicar SOLO con OK explícito ("aplica la migración goals").

DO $$ BEGIN
  CREATE TYPE propyte_crm."GoalScope" AS ENUM ('USER', 'TEAM', 'COMPANY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE propyte_crm."GoalMetric" AS ENUM (
    'CAPTACIONES','NEGOCIOS_CREADOS','COTIZACIONES_ENVIADAS',
    'ACTIVIDADES_COMPLETADAS','NEGOCIOS_GANADOS','MONTO_VENTA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS propyte_crm.goals (
  id           text PRIMARY KEY,
  scope        propyte_crm."GoalScope" NOT NULL,
  "userId"     text REFERENCES propyte_crm.users(id),
  "teamId"     text REFERENCES propyte_crm.teams(id),
  period       timestamp(3) NOT NULL,
  metric       propyte_crm."GoalMetric" NOT NULL,
  target       numeric(14,2) NOT NULL,
  currency     propyte_crm."Currency",
  "createdById" text NOT NULL REFERENCES propyte_crm.users(id),
  "createdAt"  timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt"  timestamp(3) NOT NULL DEFAULT now(),
  "deletedAt"  timestamp(3)
);
CREATE INDEX IF NOT EXISTS "goals_period_idx" ON propyte_crm.goals(period);
CREATE INDEX IF NOT EXISTS "goals_userId_idx" ON propyte_crm.goals("userId");
CREATE INDEX IF NOT EXISTS "goals_teamId_idx" ON propyte_crm.goals("teamId");
```

> Verifica los `@@map` reales de las tablas `users`/`teams` y el nombre del enum `Currency` en el schema; ajusta el SQL si difieren. (No se crea el unique en SQL por el tema de NULLs; el app hace upsert manual.)

- [ ] **Step 4: Validar + generar**

Run: `npx prisma validate` → debe decir que el schema es válido.
Run: `npx prisma generate` → genera el cliente (NORMAL, con engine — NUNCA `--no-engine`, eso rompe el runtime). Si la DLL está bloqueada en Windows, parar el dev server primero.

- [ ] **Step 5: Commit** (NO aplicar la migración)

```bash
git add prisma/schema.prisma prisma/migrations-manual/2026-06-16-goals.sql
git commit -m "feat(goals): schema Prisma Goal + enums + SQL aditivo (no aplicado)"
```

---

### Task 2: Helpers puros + tests (TDD)

**Files:**
- Create: `src/lib/goals/progress.ts`
- Test: `src/lib/goals/progress.test.ts`

- [ ] **Step 1: Test que falla** `src/lib/goals/progress.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { monthRange, computeGoalProgress } from "./progress";

describe("monthRange", () => {
  it("start = period, end = +1 mes", () => {
    const { start, end } = monthRange(new Date(Date.UTC(2026, 5, 1))); // jun 2026
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
  it("cruza el año dic→ene", () => {
    const { end } = monthRange(new Date(Date.UTC(2026, 11, 1))); // dic 2026
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("computeGoalProgress", () => {
  it("met cuando actual >= target", () => {
    expect(computeGoalProgress(10, 10)).toEqual({ pct: 100, status: "met" });
    expect(computeGoalProgress(10, 12).status).toBe("met");
  });
  it("on_track cuando pct >= 70 y < 100", () => {
    expect(computeGoalProgress(10, 7)).toEqual({ pct: 70, status: "on_track" });
  });
  it("behind cuando pct < 70", () => {
    expect(computeGoalProgress(10, 4)).toEqual({ pct: 40, status: "behind" });
  });
  it("target <= 0 → pct 0 sin dividir por cero", () => {
    expect(computeGoalProgress(0, 5)).toEqual({ pct: 0, status: "behind" });
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npx vitest run src/lib/goals/progress.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar** `src/lib/goals/progress.ts`:

```ts
import { addMonths } from "date-fns";

/** Rango [start, end) del mes que arranca en `period` (1er día del mes). */
export function monthRange(period: Date): { start: Date; end: Date } {
  return { start: period, end: addMonths(period, 1) };
}

export type GoalStatus = "met" | "on_track" | "behind";

/** % de avance (0..100+) y estado. target<=0 → pct 0 (evita /0). */
export function computeGoalProgress(
  target: number,
  actual: number
): { pct: number; status: GoalStatus } {
  if (target <= 0) return { pct: 0, status: "behind" };
  const pct = Math.round((actual / target) * 100);
  const status: GoalStatus = actual >= target ? "met" : pct >= 70 ? "on_track" : "behind";
  return { pct, status };
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npx vitest run src/lib/goals/progress.test.ts`
Expected: PASS (2 + 4 casos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/goals/
git commit -m "feat(goals): helpers puros monthRange + computeGoalProgress + tests"
```

---

### Task 3: Capa server `src/server/goals.ts`

**Files:**
- Create: `src/server/goals.ts`

- [ ] **Step 1: Implementar** `src/server/goals.ts`:

```ts
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { monthRange, computeGoalProgress, type GoalStatus } from "@/lib/goals/progress";

type Scope = "USER" | "TEAM" | "COMPANY";
type Metric =
  | "CAPTACIONES" | "NEGOCIOS_CREADOS" | "COTIZACIONES_ENVIADAS"
  | "ACTIVIDADES_COMPLETADAS" | "NEGOCIOS_GANADOS" | "MONTO_VENTA";

// IDs de usuario para un scope (undefined = sin filtro = COMPANY).
async function ownerIdsForScope(
  scope: Scope, userId: string | null, teamId: string | null
): Promise<string[] | undefined> {
  if (scope === "USER") return userId ? [userId] : [];
  if (scope === "TEAM") {
    if (!teamId) return [];
    const members = await prisma.teamMember.findMany({
      where: { teamId, leftAt: null }, select: { userId: true },
    });
    return members.map((m) => m.userId);
  }
  return undefined; // COMPANY
}

/** Calcula el real de una métrica para un scope/periodo. */
export async function computeActual(input: {
  metric: Metric; scope: Scope; userId: string | null; teamId: string | null;
  period: Date; currency: "MXN" | "USD" | null;
}): Promise<number> {
  const { start, end } = monthRange(input.period);
  const owners = await ownerIdsForScope(input.scope, input.userId, input.teamId);
  // Filtro por usuario asignado. owners=[] (scope sin miembros) → no cuenta nada.
  if (owners && owners.length === 0) return 0;
  const ownerIn = owners ? { in: owners } : undefined; // undefined = COMPANY

  switch (input.metric) {
    case "CAPTACIONES":
      return prisma.contact.count({
        where: { deletedAt: null, createdAt: { gte: start, lt: end }, ...(ownerIn ? { assignedToId: ownerIn } : {}) },
      });
    case "NEGOCIOS_CREADOS":
      return prisma.deal.count({
        where: { deletedAt: null, createdAt: { gte: start, lt: end }, ...(ownerIn ? { assignedToId: ownerIn } : {}) },
      });
    case "COTIZACIONES_ENVIADAS":
      return prisma.quote.count({
        where: {
          deletedAt: null, status: "SENT", sentAt: { gte: start, lt: end },
          ...(ownerIn ? { deal: { assignedToId: ownerIn } } : {}),
        },
      });
    case "ACTIVIDADES_COMPLETADAS":
      return prisma.activity.count({
        where: { deletedAt: null, status: "COMPLETADA", completedAt: { gte: start, lt: end }, ...(ownerIn ? { userId: ownerIn } : {}) },
      });
    case "NEGOCIOS_GANADOS":
      return prisma.deal.count({
        where: { deletedAt: null, stage: "WON", actualCloseDate: { gte: start, lt: end }, ...(ownerIn ? { assignedToId: ownerIn } : {}) },
      });
    case "MONTO_VENTA": {
      const agg = await prisma.deal.aggregate({
        _sum: { estimatedValue: true },
        where: {
          deletedAt: null, stage: "WON", actualCloseDate: { gte: start, lt: end },
          ...(input.currency ? { currency: input.currency } : {}),
          ...(ownerIn ? { assignedToId: ownerIn } : {}),
        },
      });
      return Number(agg._sum.estimatedValue ?? 0);
    }
  }
}

export interface ScorecardRow {
  goal: {
    id: string; scope: Scope; userId: string | null; teamId: string | null;
    metric: Metric; target: number; currency: "MXN" | "USD" | null; period: string;
  };
  actual: number;
  pct: number;
  status: GoalStatus;
}

/** Upsert manual (el unique con NULLs no es confiable en Postgres). */
export async function upsertGoal(input: {
  scope: Scope; userId?: string | null; teamId?: string | null;
  period: Date; metric: Metric; target: number; currency?: "MXN" | "USD" | null;
  createdById: string;
}): Promise<{ error: string } | { goal: { id: string } }> {
  const userId = input.scope === "USER" ? input.userId ?? null : null;
  const teamId = input.scope === "TEAM" ? input.teamId ?? null : null;
  if (input.scope === "USER" && !userId) return { error: "scope USER requiere userId" };
  if (input.scope === "TEAM" && !teamId) return { error: "scope TEAM requiere teamId" };
  const currency = input.metric === "MONTO_VENTA" ? input.currency ?? "MXN" : null;
  if (input.target <= 0) return { error: "target debe ser > 0" };

  const existing = await prisma.goal.findFirst({
    where: { scope: input.scope, userId, teamId, period: input.period, metric: input.metric, currency, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    const goal = await prisma.goal.update({ where: { id: existing.id }, data: { target: input.target } });
    return { goal: { id: goal.id } };
  }
  const goal = await prisma.goal.create({
    data: {
      scope: input.scope, userId, teamId, period: input.period, metric: input.metric,
      target: input.target, currency, createdById: input.createdById,
    },
  });
  return { goal: { id: goal.id } };
}

export async function deleteGoal(id: string) {
  await prisma.goal.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true as const };
}

/** Metas del filtro + real calculado por meta (en paralelo). */
export async function getScorecard(filter: {
  period: Date; userId?: string | null; teamId?: string | null;
}): Promise<ScorecardRow[]> {
  const where: Prisma.GoalWhereInput = { deletedAt: null, period: filter.period };
  if (filter.userId) where.userId = filter.userId;
  if (filter.teamId) where.teamId = filter.teamId;
  const goals = await prisma.goal.findMany({ where, orderBy: { metric: "asc" } });
  return Promise.all(
    goals.map(async (g) => {
      const actual = await computeActual({
        metric: g.metric as Metric, scope: g.scope as Scope,
        userId: g.userId, teamId: g.teamId, period: g.period,
        currency: (g.currency as "MXN" | "USD" | null) ?? null,
      });
      const { pct, status } = computeGoalProgress(Number(g.target), actual);
      return {
        goal: {
          id: g.id, scope: g.scope as Scope, userId: g.userId, teamId: g.teamId,
          metric: g.metric as Metric, target: Number(g.target),
          currency: (g.currency as "MXN" | "USD" | null) ?? null,
          period: g.period.toISOString().slice(0, 7),
        },
        actual, pct, status,
      };
    })
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores en `src/server/goals.ts` (ignorar errores pre-existentes ajenos). Si algún nombre de campo Prisma difiere (p. ej. `Quote.deal` relación, `Activity.completedAt`), corregir verificando `prisma/schema.prisma`.

- [ ] **Step 3: Commit**

```bash
git add src/server/goals.ts
git commit -m "feat(goals): capa server (computeActual derivado, upsert manual, scorecard)"
```

---

### Task 4: API REST `/api/goals`

**Files:**
- Create: `src/app/api/goals/route.ts`
- Create: `src/app/api/goals/[id]/route.ts`
- Create: `src/app/api/goals/scorecard/route.ts`

- [ ] **Step 1: `src/app/api/goals/route.ts`** (crear/upsert meta):

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { upsertGoal } from "@/server/goals";

const SET_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"];

function parsePeriod(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!SET_ROLES.includes(session.user.role as string)) {
    return NextResponse.json({ error: "Sin permiso para fijar metas" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const period = typeof body?.period === "string" ? parsePeriod(body.period) : null;
    if (!period) return NextResponse.json({ error: "period inválido (YYYY-MM)" }, { status: 400 });
    if (!body?.scope || !body?.metric || body?.target == null) {
      return NextResponse.json({ error: "scope, metric y target son requeridos" }, { status: 400 });
    }
    const result = await upsertGoal({
      scope: body.scope, userId: body.userId ?? null, teamId: body.teamId ?? null,
      period, metric: body.metric, target: Number(body.target), currency: body.currency ?? null,
      createdById: session.user.id,
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ data: result.goal }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/goals]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
```

- [ ] **Step 2: `src/app/api/goals/[id]/route.ts`** (soft-delete):

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { deleteGoal } from "@/server/goals";

const SET_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"];

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!SET_ROLES.includes(session.user.role as string)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  try {
    await deleteGoal(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/goals/[id]]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
```

- [ ] **Step 3: `src/app/api/goals/scorecard/route.ts`** (GET con RBAC de vista):

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getScorecard } from "@/server/goals";

const OWN_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "HOSTESS"];

function parsePeriod(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const period = parsePeriod(request.nextUrl.searchParams.get("period"));
  if (!period) return NextResponse.json({ error: "period requerido (YYYY-MM)" }, { status: 400 });

  let userId = request.nextUrl.searchParams.get("userId") ?? undefined;
  const teamId = request.nextUrl.searchParams.get("teamId") ?? undefined;

  // Los roles "propios" solo pueden ver su propio scorecard.
  if (OWN_ROLES.includes(session.user.role as string)) {
    userId = session.user.id;
  }

  const data = await getScorecard({ period, userId, teamId });
  return NextResponse.json({ data });
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores en las 3 rutas.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/goals/
git commit -m "feat(goals): API REST (upsert/delete metas + scorecard con RBAC)"
```

---

### Task 5: Página `/metas` + entrada en sidebar

**Files:**
- Create: `src/app/(dashboard)/metas/page.tsx` (server)
- Create: `src/components/goals/metas-client.tsx` (client)
- Modify: el sidebar (buscar el componente real, p. ej. `src/components/layout/sidebar.tsx`)

- [ ] **Step 1: Server page** `src/app/(dashboard)/metas/page.tsx`:

```tsx
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { MetasClient } from "@/components/goals/metas-client";

export const dynamic = "force-dynamic";

export default async function MetasPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  const SET_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"];
  const canEdit = SET_ROLES.includes(session.user.role as string);
  return (
    <MetasClient canEdit={canEdit} selfUserId={session.user.id} role={session.user.role as string} />
  );
}
```

- [ ] **Step 2: Client** `src/components/goals/metas-client.tsx`. Implementa: selector de mes (default mes actual), si `canEdit` un selector de asesor (reusa `AdvisorSelect` de `@/components/shared/advisor-select`) + botón "Nueva meta" (modal con `@/components/ui/dialog`), y la tabla de scorecard. Si NO `canEdit`, fuerza su propio `userId` y oculta edición. Código completo:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { AdvisorSelect } from "@/components/shared/advisor-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const METRIC_LABEL: Record<string, string> = {
  CAPTACIONES: "Captaciones",
  NEGOCIOS_CREADOS: "Negocios creados",
  COTIZACIONES_ENVIADAS: "Cotizaciones enviadas",
  ACTIVIDADES_COMPLETADAS: "Actividades completadas",
  NEGOCIOS_GANADOS: "Negocios ganados",
  MONTO_VENTA: "Monto de venta",
};
const METRICS = Object.keys(METRIC_LABEL);

interface Row {
  goal: { id: string; metric: string; target: number; currency: string | null };
  actual: number;
  pct: number;
  status: "met" | "on_track" | "behind";
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmt(n: number, currency?: string | null) {
  if (currency) return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  return new Intl.NumberFormat("es-MX").format(n);
}
const STATUS_COLOR: Record<string, string> = {
  met: "var(--text-primary)",
  on_track: "var(--text-secondary)",
  behind: "var(--color-error, #DC2626)",
};

export function MetasClient({ canEdit, selfUserId, role }: { canEdit: boolean; selfUserId: string; role: string }) {
  const [period, setPeriod] = useState(currentMonth());
  const [userId, setUserId] = useState<string | null>(canEdit ? null : selfUserId);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  // form de nueva meta
  const [fMetric, setFMetric] = useState("NEGOCIOS_CREADOS");
  const [fTarget, setFTarget] = useState("");
  const [fCurrency, setFCurrency] = useState("MXN");

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ period });
    const uid = canEdit ? userId : selfUserId;
    if (uid) qs.set("userId", uid);
    const res = await fetch(`/api/goals/scorecard?${qs.toString()}`);
    const json = await res.json();
    setRows(json.data ?? []);
    setLoading(false);
  }, [period, userId, canEdit, selfUserId]);

  useEffect(() => { load(); }, [load]);

  async function createGoal() {
    const uid = userId;
    if (!uid) { alert("Selecciona un asesor"); return; }
    const res = await fetch("/api/goals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "USER", userId: uid, period, metric: fMetric,
        target: Number(fTarget), currency: fMetric === "MONTO_VENTA" ? fCurrency : undefined,
      }),
    });
    if (res.ok) { setOpen(false); setFTarget(""); await load(); }
    else { const j = await res.json(); alert(j.error ?? "Error"); }
  }

  async function removeGoal(id: string) {
    const res = await fetch(`/api/goals/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">Metas</h1>
          <p className="text-[13px] text-[color:var(--text-tertiary)]">Avance del mes contra meta</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-[13px]">
            <span className="block text-[color:var(--text-tertiary)]">Mes</span>
            <input type="month" className="form-input text-[13px]" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </label>
          {canEdit && (
            <label className="text-[13px]">
              <span className="block text-[color:var(--text-tertiary)]">Asesor</span>
              <AdvisorSelect value={userId} onChange={(v) => setUserId(v)} />
            </label>
          )}
          {canEdit && (
            <button className="btn-primary text-xs" onClick={() => setOpen(true)}>Nueva meta</button>
          )}
        </div>
      </div>

      <div className="crm-card p-0 overflow-hidden">
        {loading ? (
          <p className="p-4 text-[13px] text-[color:var(--text-tertiary)]">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-[13px] text-[color:var(--text-tertiary)]">
            {canEdit && !userId ? "Selecciona un asesor para ver/fijar sus metas." : "Sin metas este mes."}
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-left text-[color:var(--text-tertiary)]">
                <th className="px-4 py-2">Métrica</th>
                <th className="px-4 py-2 text-right">Real</th>
                <th className="px-4 py-2 text-right">Meta</th>
                <th className="px-4 py-2">Avance</th>
                {canEdit && <th className="px-4 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.goal.id} className="border-b border-[var(--border-subtle)]">
                  <td className="px-4 py-2">{METRIC_LABEL[r.goal.metric] ?? r.goal.metric}{r.goal.currency ? ` (${r.goal.currency})` : ""}</td>
                  <td className="px-4 py-2 text-right">{fmt(r.actual, r.goal.metric === "MONTO_VENTA" ? r.goal.currency : null)}</td>
                  <td className="px-4 py-2 text-right">{fmt(r.goal.target, r.goal.metric === "MONTO_VENTA" ? r.goal.currency : null)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 rounded bg-[var(--border-subtle)]">
                        <div className="h-1.5 rounded" style={{ width: `${Math.min(r.pct, 100)}%`, background: STATUS_COLOR[r.status] }} />
                      </div>
                      <span style={{ color: STATUS_COLOR[r.status] }}>{r.pct}%</span>
                    </div>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2 text-right">
                      <button className="text-xs text-[color:var(--text-tertiary)] hover:underline" onClick={() => removeGoal(r.goal.id)}>Borrar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nueva meta</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="block text-[13px]">
              <span className="text-[color:var(--text-tertiary)]">Métrica</span>
              <select className="form-input w-full text-[13px]" value={fMetric} onChange={(e) => setFMetric(e.target.value)}>
                {METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
              </select>
            </label>
            {fMetric === "MONTO_VENTA" && (
              <label className="block text-[13px]">
                <span className="text-[color:var(--text-tertiary)]">Moneda</span>
                <select className="form-input w-full text-[13px]" value={fCurrency} onChange={(e) => setFCurrency(e.target.value)}>
                  <option value="MXN">MXN</option>
                  <option value="USD">USD</option>
                </select>
              </label>
            )}
            <label className="block text-[13px]">
              <span className="text-[color:var(--text-tertiary)]">Meta (target)</span>
              <input type="number" min="1" className="form-input w-full text-[13px]" value={fTarget} onChange={(e) => setFTarget(e.target.value)} />
            </label>
            <button className="btn-primary w-full text-sm" onClick={createGoal}>Guardar meta</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Entrada en el sidebar.** Localiza el componente del sidebar (busca dónde se listan `/hoy`, `/cotizaciones`, `/cobranza` — probablemente `src/components/layout/sidebar.tsx`). Agrega un item de navegación a `/metas` con label "Metas" (icono de lucide-react ya importado, p. ej. `Target`), en el grupo de Ventas/Dirección, replicando el patrón exacto de los items existentes (no inventar estructura).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores. Si `crm-card`/`form-input`/`btn-primary`/vars no existen con ese nombre, verifica en `globals.css` y usa los reales (mismos que usa `ShortlistPanel`/`ActivityLog`).

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/metas/ src/components/goals/ src/components/layout/sidebar.tsx
git commit -m "feat(goals): página /metas (scorecard + alta de metas) + nav"
```

---

### Task 6: Widget "Mi avance del mes" en `/hoy`

**Files:**
- Create: `src/components/goals/mi-avance-widget.tsx` (client)
- Modify: `src/app/(dashboard)/hoy/page.tsx` (montar el widget)

- [ ] **Step 1: Widget** `src/components/goals/mi-avance-widget.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

const METRIC_LABEL: Record<string, string> = {
  CAPTACIONES: "Captaciones",
  NEGOCIOS_CREADOS: "Negocios creados",
  COTIZACIONES_ENVIADAS: "Cotizaciones",
  ACTIVIDADES_COMPLETADAS: "Actividades",
  NEGOCIOS_GANADOS: "Ganados",
  MONTO_VENTA: "Monto",
};
const STATUS_COLOR: Record<string, string> = {
  met: "var(--text-primary)", on_track: "var(--text-secondary)", behind: "var(--color-error, #DC2626)",
};

interface Row { goal: { id: string; metric: string; target: number }; actual: number; pct: number; status: string }

export function MiAvanceWidget() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const d = new Date();
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    fetch(`/api/goals/scorecard?period=${period}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []).slice(0, 3)))
      .catch(() => setRows([]))
      .finally(() => setLoaded(true));
  }, []);

  if (loaded && rows.length === 0) return null; // sin metas → no estorba

  return (
    <section className="crm-card p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--text-tertiary)]">Mi avance del mes</h3>
      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.goal.id} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-[color:var(--text-secondary)]">{METRIC_LABEL[r.goal.metric] ?? r.goal.metric}</span>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-20 rounded bg-[var(--border-subtle)]">
                <div className="h-1.5 rounded" style={{ width: `${Math.min(r.pct, 100)}%`, background: STATUS_COLOR[r.status] }} />
              </div>
              <span style={{ color: STATUS_COLOR[r.status] }}>{r.pct}%</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Montar en `/hoy`.** En `src/app/(dashboard)/hoy/page.tsx`, importar y renderizar `<MiAvanceWidget />` dentro del layout de la página (cerca de los otros bloques; es un client component embebido en el server component — válido). `import { MiAvanceWidget } from "@/components/goals/mi-avance-widget";`

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/components/goals/mi-avance-widget.tsx "src/app/(dashboard)/hoy/page.tsx"
git commit -m "feat(goals): widget 'mi avance del mes' en /hoy"
```

---

### Task 7: Verificación + gate de migración + smoke local

**Files:** ninguno.

- [ ] **Step 1: Suite de tests**

Run: `npx vitest run`
Expected: verde (previos + 6 casos nuevos de progress → 97 tests aprox).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exit 0; aparece la ruta `/metas` y `/api/goals/scorecard`.

- [ ] **Step 3: GATE — pedir OK a Luis para aplicar la migración** (BD compartida):
> "Build + tests verdes. Para probar `/metas` en local necesito crear la tabla `goals` (+2 enums) en la Supabase compartida (`2026-06-16-goals.sql`, additiva, riesgo nulo). ¿Aplico la migración goals?"

Esperar "aplica la migración goals".

- [ ] **Step 4: Aplicar (sólo tras OK) vía MCP Supabase** el contenido de `prisma/migrations-manual/2026-06-16-goals.sql` en `oaijxdpevakashxshhvm`. Luego `npx prisma generate` (NORMAL).

- [ ] **Step 5: Smoke local** (`localhost:3002` o el puerto activo): entrar a `/metas` como admin, seleccionar un asesor, crear una meta (p. ej. NEGOCIOS_CREADOS target 5), ver el real calculado vs meta con barra; crear meta MONTO_VENTA MXN; borrar una meta; en `/hoy` ver el widget "mi avance del mes" para un usuario con metas. Usar datos de prueba.

---

## Self-Review (completado por el autor del plan)

- **Cobertura del spec:** modelo §Goal → Task 1. Derivación `computeActual` → Task 3. Helpers puros → Task 2. API (upsert/delete/scorecard + RBAC) → Task 4. Página `/metas` → Task 5. Widget `/hoy` → Task 6. Pruebas → Task 2 + Task 7. Gate migración → Task 7. ✅
- **Consistencia de tipos:** `monthRange`/`computeGoalProgress`/`GoalStatus` (Task 2) usados en Task 3. `computeActual`/`upsertGoal`/`deleteGoal`/`getScorecard` (Task 3) consumidos por las rutas (Task 4). Forma de `ScorecardRow` (`{goal:{metric,target,currency},actual,pct,status}`) consumida por el cliente de Task 5 y el widget de Task 6 (mismos campos). Payload POST `/api/goals` (`scope,userId,period,metric,target,currency`) coincide con `upsertGoal`. ✅
- **Sin placeholders.** Código completo en cada paso.
- **Notas verificables en implementación:** nombres reales del sidebar y de las clases CSS B/N; relación `Quote.deal`/`Activity.completedAt`/`Activity.userId`; `@@map` de `users`/`teams` para el SQL. El plan instruye verificarlos.
- **Gotcha NULL-unique** resuelto con upsert manual (findFirst) en Task 3, no `prisma.goal.upsert`.
- **`prisma generate` SIEMPRE normal** (nunca `--no-engine`) — recordatorio en Task 1/Task 7 por el bug de la sesión pasada.
