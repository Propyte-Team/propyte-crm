# Editor de Cadencias (ActionPlan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editor visual para crear/editar cadencias (ActionPlan + pasos) en /configuracion, + evaluación de condiciones de salida en el scheduler.

**Architecture:** Reusa el modelo `ActionPlan`/`ActionPlanStep` y el DSL `evaluateConditions`. Tres capas: (1) backend — el scheduler evalúa `plan.exitConditions` antes de cada paso, reusando un `loadEntityContext` extraído de `buildContext`; (2) API CRUD `/api/admin/automation/plans`; (3) UI editor en `automation-section.tsx`.

**Tech Stack:** Next.js 14 (app router), Prisma, TypeScript, vitest, React/Tailwind, zod.

**Reglas del repo:** worktree aislado `feat/crm-cadence-editor` (desde `origin/main` `8bc7855`). Autor git `Propyte-Luis <webkoi@webkoi-ai.com>` (verificar antes de cada commit; cada mensaje termina con `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`). Test runner `npx vitest run <ruta>`. Typecheck `npx tsc --noEmit -p tsconfig.json` (IGNORAR los 2 errores PRE-EXISTENTES en `src/lib/workflows/builder-model.test.ts`). Si prisma pide DATABASE_URL: `export DATABASE_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder'`. **Sin migración** (no hay cambio de schema) → no tocar BD remota.

---

## File Structure

- `src/lib/workflows/engine.ts` — MODIFY: extraer `loadEntityContext(entityType, entityId)`; `buildContext` delega en él.
- `src/lib/workflows/scheduler.ts` — MODIFY: `runEnrollments` evalúa `plan.exitConditions` antes de encolar.
- `src/lib/workflows/scheduler-exit.test.ts` — CREATE.
- `src/app/api/admin/automation/plans/route.ts` — CREATE: `POST` crear, (lista vía GET existente).
- `src/app/api/admin/automation/plans/[id]/route.ts` — CREATE: `PUT` editar+reemplazar pasos, `DELETE` soft-delete.
- `src/lib/workflows/cadence-model.ts` — CREATE: lógica pura (zod de plan/step + normalización de orden).
- `src/lib/workflows/cadence-model.test.ts` — CREATE.
- `src/components/config/cadence-editor.tsx` — CREATE: editor UI (lista + form).
- `src/components/config/automation-section.tsx` — MODIFY: montar el editor (botón Nueva/Editar).

---

## Task 1: Extraer `loadEntityContext` de `buildContext`

**Files:**
- Modify: `src/lib/workflows/engine.ts`
- Test: `src/lib/workflows/load-entity-context.test.ts` (CREATE)

- [ ] **Step 1: Escribir test que falla** (mock prisma; verifica shape para contact y deal)

`src/lib/workflows/load-entity-context.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFind = vi.fn();
const dealFind = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFind(...a) },
    deal: { findUnique: (...a: unknown[]) => dealFind(...a) },
    conversation: { findUnique: vi.fn() },
  },
}));

import { loadEntityContext } from "./engine";

beforeEach(() => { contactFind.mockReset(); dealFind.mockReset(); });

describe("loadEntityContext", () => {
  it("contact: expone contact con score numérico y adAttribution", async () => {
    contactFind.mockResolvedValue({ id: "c1", score: 50, adAttribution: { campaignName: "X" } });
    const ctx = await loadEntityContext("contact", "c1");
    expect((ctx.contact as { id: string }).id).toBe("c1");
    expect((ctx.contact as { score: number }).score).toBe(50);
    expect(ctx.adAttribution).toEqual({ campaignName: "X" });
  });

  it("deal: expone deal + su contact", async () => {
    dealFind.mockResolvedValue({ id: "d1", contactId: "c1" });
    contactFind.mockResolvedValue({ id: "c1", score: 0, adAttribution: null });
    const ctx = await loadEntityContext("deal", "d1");
    expect((ctx.deal as { id: string }).id).toBe("d1");
    expect((ctx.contact as { id: string }).id).toBe("c1");
  });
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npx vitest run src/lib/workflows/load-entity-context.test.ts`
Expected: FAIL ("loadEntityContext is not a function" / no export).

- [ ] **Step 3: Refactor en `engine.ts`** — extraer la carga de contexto. Reemplazar el cuerpo actual de `buildContext` (la parte que llena `ctx.contact`/`ctx.deal`/`ctx.adAttribution` y normaliza score) por una llamada a un nuevo `loadEntityContext`. Código:

```ts
// Carga el contexto de un entity (sin requerir un WorkflowEvent). Compartido por
// buildContext (motor) y el scheduler (exitConditions de cadencias).
export async function loadEntityContext(
  entityType: string,
  entityId: string,
): Promise<Record<string, unknown>> {
  const ctx: Record<string, unknown> = {};
  const withAd = { adAttribution: true } as const;
  if (entityType === "contact") {
    ctx.contact = await prisma.contact.findUnique({ where: { id: entityId }, include: withAd });
  } else if (entityType === "deal") {
    const deal = await prisma.deal.findUnique({ where: { id: entityId } });
    ctx.deal = deal;
    if (deal) ctx.contact = await prisma.contact.findUnique({ where: { id: deal.contactId }, include: withAd });
  } else if (entityType === "conversation") {
    const conv = await prisma.conversation.findUnique({ where: { id: entityId } });
    if (conv) ctx.contact = await prisma.contact.findUnique({ where: { id: conv.contactId }, include: withAd });
  }
  const c = ctx.contact as { score?: unknown } | null;
  if (c && typeof c === "object") (c as Record<string, unknown>).score = Number((c as { score?: unknown }).score ?? 0);
  ctx.adAttribution = (ctx.contact as { adAttribution?: unknown } | null)?.adAttribution ?? null;
  return ctx;
}
```

Y reescribir `buildContext` para delegar:
```ts
export async function buildContext(event: WorkflowEvent): Promise<Record<string, unknown>> {
  const entityCtx = await loadEntityContext(event.entityType, event.entityId);
  return {
    ...entityCtx,
    event: { type: event.type, payload: event.payload ?? {} },
    context: { isBusinessHours: isBusinessHoursNow() },
  };
}
```

> Verifica que el `case "contact.lifecycle_changed"` auto-advance (sub-A) en `processEvent` sigue leyendo `ctx.contact` igual — no cambia, `loadEntityContext` preserva la forma.

- [ ] **Step 4: Correr el test nuevo + los del motor**

Run: `npx vitest run src/lib/workflows/load-entity-context.test.ts src/lib/workflows/lifecycle-engine.test.ts`
Expected: PASS ambos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/engine.ts src/lib/workflows/load-entity-context.test.ts
git commit -m "refactor(workflows): extraer loadEntityContext de buildContext (reuso scheduler)"
```

---

## Task 2: Scheduler evalúa `exitConditions`

**Files:**
- Modify: `src/lib/workflows/scheduler.ts`
- Test: `src/lib/workflows/scheduler-exit.test.ts` (CREATE)

- [ ] **Step 1: Escribir test que falla**

`src/lib/workflows/scheduler-exit.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const enrFind = vi.fn();
const enrUpdate = vi.fn();
const enqueue = vi.fn();
const loadCtx = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    actionPlanEnrollment: {
      findMany: (...a: unknown[]) => enrFind(...a),
      update: (...a: unknown[]) => enrUpdate(...a),
    },
  },
}));
vi.mock("./queue", () => ({ enqueueAction: (...a: unknown[]) => enqueue(...a) }));
vi.mock("./engine", () => ({ loadEntityContext: (...a: unknown[]) => loadCtx(...a) }));

import { runEnrollments } from "./scheduler";

function enrollment(exitConditions: unknown) {
  return {
    id: "e1", entityType: "contact", entityId: "c1", currentStep: 0,
    plan: { isActive: true, exitConditions, steps: [
      { id: "s1", order: 0, actionType: "SEND_WHATSAPP", delayMinutes: 0, config: {}, autonomyLevel: "L0" },
      { id: "s2", order: 1, actionType: "SEND_WHATSAPP", delayMinutes: 60, config: {}, autonomyLevel: "L0" },
    ] },
  };
}

beforeEach(() => { enrFind.mockReset(); enrUpdate.mockReset(); enqueue.mockReset(); loadCtx.mockReset(); });

describe("runEnrollments exitConditions", () => {
  it("sale EXITED cuando exitConditions matchea (no encola)", async () => {
    enrFind.mockResolvedValue([enrollment({ all: [{ field: "contact.contactStatus", op: "eq", value: "CONTACTADO" }] })]);
    loadCtx.mockResolvedValue({ contact: { contactStatus: "CONTACTADO" } });
    await runEnrollments();
    expect(enqueue).not.toHaveBeenCalled();
    expect(enrUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "EXITED" }),
    }));
  });

  it("corre normal cuando exitConditions NO matchea", async () => {
    enrFind.mockResolvedValue([enrollment({ all: [{ field: "contact.contactStatus", op: "eq", value: "CONTACTADO" }] })]);
    loadCtx.mockResolvedValue({ contact: { contactStatus: "NUEVO" } });
    await runEnrollments();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("exitConditions vacío {} NO provoca salida (corre normal, sin cargar contexto)", async () => {
    enrFind.mockResolvedValue([enrollment({})]);
    await runEnrollments();
    expect(loadCtx).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npx vitest run src/lib/workflows/scheduler-exit.test.ts`
Expected: FAIL (hoy siempre encola; no evalúa exitConditions).

- [ ] **Step 3: Implementar en `runEnrollments`** — dentro del `for (const enr of due)`, justo después de obtener `step` y ANTES del `enqueueAction`, agregar el bloque de salida. Importar arriba: `import { loadEntityContext } from "./engine";` y `import { evaluateConditions } from "./evaluate-conditions";`.

```ts
    // Condiciones de salida del plan (sub-B): si matchean, salir antes de encolar.
    const exitCond = enr.plan.exitConditions as Record<string, unknown> | null;
    if (step && enr.plan.isActive && exitCond && Object.keys(exitCond).length > 0) {
      const ctx = await loadEntityContext(enr.entityType, enr.entityId);
      if (evaluateConditions(exitCond as never, ctx as never)) {
        await prisma.actionPlanEnrollment.update({
          where: { id: enr.id },
          data: { status: "EXITED", exitedAt: new Date(), nextRunAt: null },
        });
        continue;
      }
    }
```

> Va DESPUÉS del guard existente `if (!step || !enr.plan.isActive) {...continue;}` (para que `step` ya esté garantizado) y ANTES del `enqueueAction`. El guard `Object.keys(exitCond).length > 0` es CRÍTICO: `evaluateConditions({})` devuelve `true` (base case) → sin el guard, todo enrollment saldría de inmediato.

- [ ] **Step 4: Correr el test + el resto de workflows**

Run: `npx vitest run src/lib/workflows/scheduler-exit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/scheduler.ts src/lib/workflows/scheduler-exit.test.ts
git commit -m "feat(cadencias): scheduler evalúa exitConditions y sale EXITED si matchea"
```

---

## Task 3: Lógica pura del editor — `cadence-model.ts`

**Files:**
- Create: `src/lib/workflows/cadence-model.ts`
- Test: `src/lib/workflows/cadence-model.test.ts`

- [ ] **Step 1: Escribir test que falla**

`src/lib/workflows/cadence-model.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { planInputSchema, normalizeStepsOrder } from "./cadence-model";

describe("cadence-model", () => {
  it("planInputSchema acepta un plan válido con pasos", () => {
    const r = planInputSchema.safeParse({
      name: "Bienvenida", description: "x", exitConditions: {},
      steps: [{ actionType: "SEND_WHATSAPP", delayMinutes: 0, config: {}, autonomyLevel: "L0" }],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza actionType inválido", () => {
    const r = planInputSchema.safeParse({
      name: "X", steps: [{ actionType: "NOPE", delayMinutes: 0, config: {}, autonomyLevel: "L0" }],
    });
    expect(r.success).toBe(false);
  });

  it("rechaza delayMinutes negativo", () => {
    const r = planInputSchema.safeParse({
      name: "X", steps: [{ actionType: "SEND_WHATSAPP", delayMinutes: -1, config: {}, autonomyLevel: "L0" }],
    });
    expect(r.success).toBe(false);
  });

  it("normalizeStepsOrder reasigna order 0..n preservando secuencia", () => {
    const out = normalizeStepsOrder([
      { actionType: "A", delayMinutes: 0, config: {}, autonomyLevel: "L0" },
      { actionType: "B", delayMinutes: 5, config: {}, autonomyLevel: "L1" },
    ] as never);
    expect(out.map((s) => s.order)).toEqual([0, 1]);
    expect(out[1].actionType).toBe("B");
  });
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npx vitest run src/lib/workflows/cadence-model.test.ts`
Expected: FAIL (no module).

- [ ] **Step 3: Implementar `cadence-model.ts`**

```ts
// Lógica pura del editor de cadencias (sub-B): zod del plan/pasos + normalización de orden.
import { z } from "zod";
import { workflowActionTypes, conditionsDslSchema } from "@/lib/validations/rebuild-f1";

export const stepInputSchema = z.object({
  actionType: z.enum(workflowActionTypes),
  delayMinutes: z.number().int().min(0).max(1_000_000),
  config: z.record(z.unknown()).default({}),
  autonomyLevel: z.enum(["L0", "L1", "L2"]).default("L0"),
});
export type StepInput = z.infer<typeof stepInputSchema>;

export const planInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  exitConditions: conditionsDslSchema.optional(),
  steps: z.array(stepInputSchema).default([]),
});
export type PlanInput = z.infer<typeof planInputSchema>;

/** Reasigna `order` 0..n-1 según la posición en el arreglo (la UI define el orden). */
export function normalizeStepsOrder(steps: StepInput[]): Array<StepInput & { order: number }> {
  return steps.map((s, i) => ({ ...s, order: i }));
}
```

> Verifica que `workflowActionTypes` y `conditionsDslSchema` se exporten de `@/lib/validations/rebuild-f1` (lo hacen; `workflowActionTypes` ya incluye `SET_LIFECYCLE` tras sub-A).

- [ ] **Step 4: Correr, verificar que pasa**

Run: `npx vitest run src/lib/workflows/cadence-model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/cadence-model.ts src/lib/workflows/cadence-model.test.ts
git commit -m "feat(cadencias): cadence-model (zod plan/step + normalize order)"
```

---

## Task 4: API — crear cadencia (`POST /api/admin/automation/plans`)

**Files:**
- Create: `src/app/api/admin/automation/plans/route.ts`
- Test: `src/app/api/admin/automation/plans/route.test.ts`

- [ ] **Step 1: Escribir test que falla** (mock session + prisma)

`src/app/api/admin/automation/plans/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));
const planCreate = vi.fn().mockResolvedValue({ id: "p1" });
const auditCreate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  default: {
    actionPlan: { create: (...a: unknown[]) => planCreate(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { POST } from "./route";

function req(body: unknown) { return new Request("http://t/api", { method: "POST", body: JSON.stringify(body) }) as never; }
beforeEach(() => { planCreate.mockClear(); session.user.role = "ADMIN"; });

describe("POST /plans", () => {
  it("crea plan con pasos ordenados", async () => {
    const res = await POST(req({ name: "Bienvenida", steps: [
      { actionType: "SEND_WHATSAPP", delayMinutes: 0, config: {}, autonomyLevel: "L0" },
      { actionType: "CREATE_TASK", delayMinutes: 60, config: {}, autonomyLevel: "L0" },
    ] }));
    expect(res.status).toBe(201);
    const arg = planCreate.mock.calls[0][0];
    expect(arg.data.steps.create.map((s: { order: number }) => s.order)).toEqual([0, 1]);
  });

  it("403 para no-admin", async () => {
    session.user.role = "ASESOR_SR";
    const res = await POST(req({ name: "X", steps: [] }));
    expect(res.status).toBe(403);
  });

  it("400 con actionType inválido", async () => {
    const res = await POST(req({ name: "X", steps: [{ actionType: "NOPE", delayMinutes: 0, config: {}, autonomyLevel: "L0" }] }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npx vitest run src/app/api/admin/automation/plans/route.test.ts`
Expected: FAIL (no module).

- [ ] **Step 3: Implementar `route.ts`**

```ts
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { planInputSchema, normalizeStepsOrder } from "@/lib/workflows/cadence-model";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const parsed = planInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { name, description, exitConditions, steps } = parsed.data;

  const plan = await prisma.actionPlan.create({
    data: {
      name, description: description ?? null, ownerUserId: session.user.id,
      exitConditions: (exitConditions ?? {}) as object,
      steps: { create: normalizeStepsOrder(steps).map((s) => ({
        order: s.order, actionType: s.actionType, delayMinutes: s.delayMinutes,
        config: s.config as object, autonomyLevel: s.autonomyLevel,
      })) },
    },
  });
  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "CREATE", entity: "ActionPlan", entityId: plan.id,
      changes: JSON.parse(JSON.stringify(parsed.data)) },
  });
  return NextResponse.json({ data: plan }, { status: 201 });
}
```

> `name` es `@unique` en el modelo; un nombre duplicado lanzará P2002. Capturar y devolver 409: envolver el `create` en try/catch y `return NextResponse.json({ error: "Ya existe una cadencia con ese nombre" }, { status: 409 })` en el catch si `e.code === "P2002"`.

- [ ] **Step 4: Agregar el manejo de P2002** (envolver el create):

```ts
  let plan;
  try {
    plan = await prisma.actionPlan.create({ /* ...igual que arriba... */ });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Ya existe una cadencia con ese nombre" }, { status: 409 });
    }
    throw e;
  }
```

- [ ] **Step 5: Correr, verificar que pasa**

Run: `npx vitest run src/app/api/admin/automation/plans/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/automation/plans/route.ts src/app/api/admin/automation/plans/route.test.ts
git commit -m "feat(cadencias): API POST crear cadencia + pasos"
```

---

## Task 5: API — editar/borrar cadencia (`PUT`/`DELETE [id]`)

**Files:**
- Create: `src/app/api/admin/automation/plans/[id]/route.ts`
- Test: `src/app/api/admin/automation/plans/[id]/route.test.ts`

- [ ] **Step 1: Escribir test que falla**

`src/app/api/admin/automation/plans/[id]/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));
const txn = { actionPlanStep: { deleteMany: vi.fn(), createMany: vi.fn() }, actionPlan: { update: vi.fn().mockResolvedValue({ id: "p1" }) } };
const planUpdate = vi.fn().mockResolvedValue({ id: "p1" });
vi.mock("@/lib/db", () => ({
  default: {
    $transaction: (fn: (tx: typeof txn) => unknown) => fn(txn),
    actionPlan: { update: (...a: unknown[]) => planUpdate(...a) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { PUT, DELETE } from "./route";

const ctx = { params: Promise.resolve({ id: "p1" }) };
function req(body: unknown) { return new Request("http://t", { method: "PUT", body: JSON.stringify(body) }) as never; }
beforeEach(() => { Object.values(txn.actionPlanStep).forEach((f) => f.mockClear()); txn.actionPlan.update.mockClear(); session.user.role = "ADMIN"; });

describe("PUT/DELETE /plans/[id]", () => {
  it("PUT reemplaza pasos (deleteMany + createMany con order 0..n)", async () => {
    const res = await PUT(req({ name: "Edit", steps: [
      { actionType: "SEND_WHATSAPP", delayMinutes: 0, config: {}, autonomyLevel: "L0" },
      { actionType: "CREATE_TASK", delayMinutes: 30, config: {}, autonomyLevel: "L0" },
    ] }), ctx);
    expect(res.status).toBe(200);
    expect(txn.actionPlanStep.deleteMany).toHaveBeenCalledWith({ where: { planId: "p1" } });
    const created = txn.actionPlanStep.createMany.mock.calls[0][0].data;
    expect(created.map((s: { order: number }) => s.order)).toEqual([0, 1]);
  });

  it("DELETE hace soft-delete (deletedAt)", async () => {
    const res = await DELETE(new Request("http://t", { method: "DELETE" }) as never, ctx);
    expect(res.status).toBe(200);
    expect(planUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "p1" }, data: expect.objectContaining({ deletedAt: expect.anything() }),
    }));
  });

  it("403 no-admin en PUT", async () => {
    session.user.role = "ASESOR_SR";
    const res = await PUT(req({ name: "X", steps: [] }), ctx);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npx vitest run "src/app/api/admin/automation/plans/[id]/route.test.ts"`
Expected: FAIL (no module).

- [ ] **Step 3: Implementar `[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { planInputSchema, normalizeStepsOrder } from "@/lib/workflows/cadence-model";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = planInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { name, description, exitConditions, steps } = parsed.data;
  const ordered = normalizeStepsOrder(steps);

  const plan = await prisma.$transaction(async (tx) => {
    await tx.actionPlanStep.deleteMany({ where: { planId: id } });
    await tx.actionPlanStep.createMany({
      data: ordered.map((s) => ({
        planId: id, order: s.order, actionType: s.actionType, delayMinutes: s.delayMinutes,
        config: s.config as object, autonomyLevel: s.autonomyLevel,
      })),
    });
    return tx.actionPlan.update({
      where: { id },
      data: { name, description: description ?? null, exitConditions: (exitConditions ?? {}) as object },
    });
  });

  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "UPDATE", entity: "ActionPlan", entityId: id,
      changes: JSON.parse(JSON.stringify(parsed.data)) },
  });
  return NextResponse.json({ data: plan }, { status: 200 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const { id } = await ctx.params;
  await prisma.actionPlan.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "DELETE", entity: "ActionPlan", entityId: id, changes: {} },
  });
  return NextResponse.json({ ok: true }, { status: 200 });
}
```

> El `name @unique` puede chocar en PUT si se renombra a uno existente (P2002). Es aceptable que devuelva 500 en v1; si se quiere 409, envolver el `$transaction` en try/catch igual que en POST. (Decisión v1: dejar simple; documentado.)

- [ ] **Step 4: Correr, verificar que pasa**

Run: `npx vitest run "src/app/api/admin/automation/plans/[id]/route.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/admin/automation/plans/[id]/route.ts" "src/app/api/admin/automation/plans/[id]/route.test.ts"
git commit -m "feat(cadencias): API PUT editar + DELETE soft-delete cadencia"
```

---

## Task 6: UI — editor de cadencias

**Files:**
- Create: `src/components/config/cadence-editor.tsx`
- Modify: `src/components/config/automation-section.tsx`

- [ ] **Step 1: Leer el componente actual y el rule builder**

Run: `sed -n '1,60p' src/components/config/automation-section.tsx && echo "---BUILDER---" && grep -nE "ACTION_TYPES|ACTION_FIELDS|Cond|condition|export" src/components/config/workflow-builder.tsx | head -30`
Expected: ver la interfaz `Plan`, el render de "Cadencias" (~línea 218-233), y los exports/constantes reutilizables del rule builder (`ACTION_TYPES`, `ACTION_FIELDS`, el constructor de condiciones).

- [ ] **Step 2: Crear `cadence-editor.tsx`** — editor con lista + form. Componente cliente. Estructura mínima (seguir patrones del rule builder para acciones/condiciones; reutilizar sus constantes si están exportadas, si no, replicar el shape):

```tsx
"use client";
import { useState } from "react";

interface StepRow { actionType: string; delayMinutes: number; config: Record<string, string>; autonomyLevel: string; }
interface PlanData { id?: string; name: string; description: string; exitConditions: unknown; steps: StepRow[]; }

const ACTION_OPTIONS = [
  "SEND_WHATSAPP", "SEND_EMAIL", "CREATE_TASK", "NOTIFY", "ADD_TAG",
  "UPDATE_FIELD", "ASSIGN", "SET_LIFECYCLE", "AI_DRAFT", "WEBHOOK",
];
const AUTONOMY = ["L0", "L1", "L2"];

export function CadenceEditor({ initial, onSaved, onCancel }: {
  initial?: PlanData; onSaved: () => void; onCancel: () => void;
}) {
  const [plan, setPlan] = useState<PlanData>(initial ?? { name: "", description: "", exitConditions: {}, steps: [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function addStep() {
    setPlan((p) => ({ ...p, steps: [...p.steps, { actionType: "SEND_WHATSAPP", delayMinutes: 0, config: {}, autonomyLevel: "L0" }] }));
  }
  function updateStep(i: number, patch: Partial<StepRow>) {
    setPlan((p) => ({ ...p, steps: p.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  }
  function removeStep(i: number) { setPlan((p) => ({ ...p, steps: p.steps.filter((_, idx) => idx !== i) })); }
  function move(i: number, dir: -1 | 1) {
    setPlan((p) => {
      const steps = [...p.steps]; const j = i + dir;
      if (j < 0 || j >= steps.length) return p;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...p, steps };
    });
  }

  async function save() {
    setBusy(true); setErr(null);
    const url = plan.id ? `/api/admin/automation/plans/${plan.id}` : "/api/admin/automation/plans";
    const res = await fetch(url, {
      method: plan.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: plan.name, description: plan.description, exitConditions: plan.exitConditions, steps: plan.steps }),
    });
    setBusy(false);
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error?.toString?.() ?? "Error al guardar"); return; }
    onSaved();
  }

  return (
    <div className="space-y-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <input value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })}
        placeholder="Nombre de la cadencia"
        className="w-full rounded-md border px-3 py-2 text-sm font-medium" />
      <textarea value={plan.description} onChange={(e) => setPlan({ ...plan, description: e.target.value })}
        placeholder="Descripción (opcional)" rows={2} className="w-full rounded-md border px-3 py-2 text-sm" />

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Pasos</p>
        {plan.steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md border border-neutral-200 p-2 text-sm dark:border-neutral-800">
            <span className="w-5 text-center text-xs text-neutral-400">{i + 1}</span>
            <label className="flex items-center gap-1">+<input type="number" min={0} value={s.delayMinutes}
              onChange={(e) => updateStep(i, { delayMinutes: Number(e.target.value) })}
              className="w-20 rounded border px-1 py-0.5" /> min</label>
            <select value={s.actionType} onChange={(e) => updateStep(i, { actionType: e.target.value })}
              className="rounded border px-1 py-0.5">
              {ACTION_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={s.autonomyLevel} onChange={(e) => updateStep(i, { autonomyLevel: e.target.value })}
              className="rounded border px-1 py-0.5">
              {AUTONOMY.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <div className="ml-auto flex gap-1">
              <button type="button" onClick={() => move(i, -1)} className="px-1 text-neutral-400 hover:text-neutral-700">↑</button>
              <button type="button" onClick={() => move(i, 1)} className="px-1 text-neutral-400 hover:text-neutral-700">↓</button>
              <button type="button" onClick={() => removeStep(i)} className="px-1 text-red-500 hover:text-red-700">✕</button>
            </div>
          </div>
        ))}
        <button type="button" onClick={addStep} className="text-xs font-medium text-neutral-600 hover:text-neutral-900">+ Agregar paso</button>
      </div>

      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !plan.name} onClick={save}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Guardando…" : "Guardar cadencia"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border px-3 py-1.5 text-sm">Cancelar</button>
      </div>
    </div>
  );
}
```

> Las condiciones de salida (`exitConditions`) en v1 pueden editarse con el MISMO constructor de condiciones del rule builder: si `workflow-builder.tsx` exporta un componente de árbol de condiciones reutilizable, móntalo aquí enlazado a `plan.exitConditions`; si NO está exportado, extráelo a un componente compartido `condition-tree.tsx` y úsalo en ambos (rule builder + cadence editor) — NO dupliques la UI de condiciones. Mantén el oficio visual del resto de /configuracion (ver `feedback_ui_craft_no_admin_template`).

- [ ] **Step 3: Montar en `automation-section.tsx`** — en la sección "Cadencias", agregar estado para abrir el editor (nueva o editar fila) y un botón "Nueva cadencia"; al guardar, refrescar la lista (re-fetch del estado de automation). Seguir el patrón de fetch/refresh ya presente en el componente.

```tsx
// dentro de AutomationSection:
const [editing, setEditing] = useState<null | "new" | PlanForEdit>(null);
// ...en el header de la sección Cadencias:
{userRole === "ADMIN" || userRole === "DIRECTOR" ? (
  <button onClick={() => setEditing("new")} className="text-xs font-medium text-neutral-600 hover:text-neutral-900">
    + Nueva cadencia
  </button>
) : null}
// ...editor:
{editing && (
  <CadenceEditor
    initial={editing === "new" ? undefined : mapPlanToEditor(editing)}
    onSaved={() => { setEditing(null); refresh(); }}
    onCancel={() => setEditing(null)}
  />
)}
// ...por cada plan en la lista, botón Editar (solo admin):
<button onClick={() => setEditing(plan)} className="text-xs text-neutral-500 hover:text-neutral-900">Editar</button>
```

`mapPlanToEditor` convierte el `Plan` del listado (que trae `steps` con `{order, actionType, delayMinutes, config, autonomyLevel}`) al shape `PlanData` del editor (ordenar por `order`, mapear campos). `refresh()` = la función que ya re-hace el GET de `/api/admin/automation` (reusar la existente; si está inline en un `useEffect`, extraerla a una función `load()` y llamarla).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos (ignorar los 2 pre-existentes de `builder-model.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/components/config/cadence-editor.tsx src/components/config/automation-section.tsx
git commit -m "feat(cadencias): editor visual de cadencias en /configuracion"
```

---

## Task 7: Verificación final

- [ ] **Step 1: Suite completa**

Run: `npx vitest run`
Expected: todos verdes (los previos + los nuevos de cadencias).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: "Compiled successfully", exit 0.

- [ ] **Step 3: Autoría**

Run: `git log --format='%an <%ae>' origin/main..HEAD | sort -u`
Expected: solo `Propyte-Luis <webkoi@webkoi-ai.com>`.

- [ ] **Step 4: Reporte a Luis** — resumen + recordar que **no hay migración** (sin gate de infra), y pedir OK para ff-merge a main (dispara auto-deploy). El editor queda usable apenas deploye; las cadencias siguen enrolándose vía la acción `ENROLL_PLAN` de las reglas.

---

## Notas de ejecución

- **Sin migración / sin gate de infra:** sub-B no cambia el schema. El código funciona contra la BD actual tal cual.
- **Orden de dependencias:** Task 1 (loadEntityContext) antes de Task 2 (scheduler lo usa). Task 3 (cadence-model) antes de Tasks 4/5 (API lo importa). Task 6 (UI) tras 4/5 (consume la API). 
- **Lección sub-A aplicada:** `actionType` se valida contra el zod `workflowActionTypes` (mismo enum canónico) — no re-listar a mano en backend. La lista `ACTION_OPTIONS` de la UI es solo presentación (subset amigable); la validación real es el zod del API.
- **No dupliques la UI de condiciones:** reusa/extrae el constructor de condiciones del rule builder para `exitConditions`.
