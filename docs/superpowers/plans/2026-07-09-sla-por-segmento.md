# SLA por segmento + minutos hábiles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el motor SLA elija la política por segmento del contacto (DSL de condiciones + prioridad) y calcule el vencimiento acumulando solo minutos hábiles según el horario de la política, con CRUD completo de políticas en `/configuracion`.

**Architecture:** Dos funciones puras nuevas (`selectSlaPolicy`, `computeDueAt`) que orquesta `createSlaTimer`; migración aditiva de 2 columnas a `SlaPolicy`; API espejo del patrón `plans`; editor de políticas en la sección Automatización.

**Tech Stack:** Next.js 14 (App Router), Prisma, Zod, Vitest, React (client component), `@/lib/workflows/evaluate-conditions` (DSL), `Intl.DateTimeFormat` para tz.

**Base:** worktree `.claude/worktrees/crm-sla-segmento`, rama `feat/crm-sla-por-segmento` off `origin/main` `97bb004`. Baseline verde: 423 tests / 70 archivos. Autor de commits: `Propyte-Luis <webkoi@webkoi-ai.com>` (ya configurado). Ejecutar comandos DENTRO del worktree.

**Convención Prisma↔SQL (para la migración manual):** tabla `propyte_crm."sla_policies"`, columnas camelCase entre comillas, enums PascalCase. NO aplicar la migración (la aplica Luis con frase de autorización).

---

## File Structure

- `prisma/schema.prisma` — MODIFICAR `model SlaPolicy` (+`conditions`, +`priority`).
- `prisma/migrations-manual/2026-07-09-sla-por-segmento.sql` — CREAR (aditivo, no aplicar).
- `src/lib/workflows/business-hours.ts` — CREAR (calculadora pura de minutos hábiles).
- `src/lib/workflows/business-hours.test.ts` — CREAR.
- `src/lib/workflows/sla-select.ts` — CREAR (selector puro de política).
- `src/lib/workflows/sla-select.test.ts` — CREAR.
- `src/lib/workflows/sla.ts` — MODIFICAR (`createSlaTimer` usa selección + businessHours; +`loadSlaContext`).
- `src/lib/workflows/sla.createTimer.test.ts` — CREAR.
- `src/lib/workflows/sla-model.ts` — CREAR (`slaPolicyInputSchema` + `businessHoursSchema`).
- `src/lib/workflows/sla-model.test.ts` — CREAR.
- `src/app/api/admin/automation/sla/route.ts` — CREAR (POST).
- `src/app/api/admin/automation/sla/[id]/route.ts` — CREAR (PUT, DELETE).
- `src/components/config/sla-policy-editor.tsx` — CREAR (lista + editor).
- `src/components/config/automation-section.tsx` — MODIFICAR (montar el editor; extender interface `Sla`).

---

## Task 1: Migración aditiva + campos de schema

**Files:**
- Modify: `prisma/schema.prisma` (model `SlaPolicy`, ~línea 1392)
- Create: `prisma/migrations-manual/2026-07-09-sla-por-segmento.sql`

- [ ] **Step 1: Añadir columnas al modelo**

En `model SlaPolicy`, tras `orphanHours Int @default(24)` añade:
```prisma
  conditions Json @default("{}")
  priority   Int  @default(100)
```

- [ ] **Step 2: Escribir la migración manual (NO aplicar)**

Crea `prisma/migrations-manual/2026-07-09-sla-por-segmento.sql`:
```sql
-- SLA por segmento (Fase 3 sub-D). Aditivo: 2 columnas con default. Reversible.
-- Aplicar en Supabase SQL Editor (oaijxdpevakashxshhvm) — un solo envío.
ALTER TABLE "propyte_crm"."sla_policies"
  ADD COLUMN IF NOT EXISTS "conditions" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 100;
```

- [ ] **Step 3: Regenerar el cliente y validar**

Run: `npx prisma generate && npx prisma validate`
Expected: "Generated Prisma Client" + "The schema at prisma/schema.prisma is valid".

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations-manual/2026-07-09-sla-por-segmento.sql
git commit -m "feat(sla): schema conditions+priority en SlaPolicy + migración aditiva"
```

---

## Task 2: Calculadora de minutos hábiles (pura)

**Files:**
- Create: `src/lib/workflows/business-hours.ts`
- Test: `src/lib/workflows/business-hours.test.ts`

**Nota de diseño:** México no observa DST desde 2022 → el offset de la tz es constante; se calcula una vez desde `startAt`. Se trabaja en "hora local como pseudo-UTC" (getUTC* devuelven la hora de pared) y al final se reconvierte a UTC real.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { computeDueAt, type BusinessHours } from "./business-hours";

// Horario 09:00–18:00 (540–1080) lun–vie; sáb/dom cerrados. tz Cancún (UTC-5, sin DST).
const BH: BusinessHours = {
  tz: "America/Cancun",
  days: { "0": null, "1": [540, 1080], "2": [540, 1080], "3": [540, 1080], "4": [540, 1080], "5": [540, 1080], "6": null },
};
// Hora de pared en Cancún de un instante (para aserciones legibles).
const wall = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cancun", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
// Construye un instante desde hora de pared Cancún (offset fijo -05:00).
const at = (iso: string) => new Date(`${iso}:00-05:00`);

describe("computeDueAt", () => {
  it("wall-clock cuando businessHours vacío", () => {
    const start = new Date("2026-07-09T20:00:00Z");
    expect(computeDueAt(start, 30, {}).getTime()).toBe(start.getTime() + 30 * 60000);
    expect(computeDueAt(start, 30, null).getTime()).toBe(start.getTime() + 30 * 60000);
  });
  it("dentro de la ventana suma directo", () => {
    // jueves 2026-07-09 15:00 + 30 → 15:30
    expect(wall(computeDueAt(at("2026-07-09T15:00"), 30, BH))).toBe("2026-07-09, 15:30");
  });
  it("antes de apertura cuenta desde la apertura", () => {
    // jueves 07:00 + 30 → 09:30
    expect(wall(computeDueAt(at("2026-07-09T07:00"), 30, BH))).toBe("2026-07-09, 09:30");
  });
  it("después del cierre pasa a la siguiente apertura", () => {
    // jueves 19:00 + 30 → viernes 09:30
    expect(wall(computeDueAt(at("2026-07-09T19:00"), 30, BH))).toBe("2026-07-10, 09:30");
  });
  it("cruza el día acumulando el resto", () => {
    // jueves 17:50 (quedan 10 min hasta 18:00) + 30 → 10 hoy + 20 viernes desde 09:00 → 09:20
    expect(wall(computeDueAt(at("2026-07-09T17:50"), 30, BH))).toBe("2026-07-10, 09:20");
  });
  it("salta fin de semana", () => {
    // sábado 2026-07-11 10:00 (cerrado) + 30 → lunes 2026-07-13 09:30
    expect(wall(computeDueAt(at("2026-07-11T10:00"), 30, BH))).toBe("2026-07-13, 09:30");
  });
  it("minutes=0 devuelve el inicio", () => {
    const start = at("2026-07-09T15:00");
    expect(computeDueAt(start, 0, BH).getTime()).toBe(start.getTime());
  });
  it("semana entera cerrada cae a wall-clock", () => {
    const allClosed: BusinessHours = { tz: "America/Cancun", days: { "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null } };
    const start = at("2026-07-09T15:00");
    expect(computeDueAt(start, 30, allClosed).getTime()).toBe(start.getTime() + 30 * 60000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/workflows/business-hours.test.ts`
Expected: FAIL ("Failed to resolve import ./business-hours" o "computeDueAt is not a function").

- [ ] **Step 3: Implementar**

```ts
// src/lib/workflows/business-hours.ts
// Calculadora de vencimiento SLA por minutos hábiles. PURA, sin BD.
// businessHours vacío/sin días abiertos → wall-clock (start + minutes).
// Supuesto: la tz no observa DST (México desde 2022) → offset constante.

export interface BusinessHours {
  tz?: string;
  days?: Record<string, [number, number] | null>; // "0".."6" (0=domingo) → [aperturaMin, cierreMin] o null (cerrado)
}

const DAY_MS = 24 * 60 * 60000;

// Minutos que la tz adelanta a UTC en `at` (negativo si va detrás; Cancún = -300).
function tzOffsetMinutes(at: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const m: Record<string, number> = {};
  for (const p of dtf.formatToParts(at)) if (p.type !== "literal") m[p.type] = Number(p.value);
  const asUTC = Date.UTC(m.year, m.month - 1, m.day, m.hour % 24, m.minute, m.second);
  return (asUTC - at.getTime()) / 60000;
}

function atMidnightNextDay(d: Date): Date {
  const n = new Date(d.getTime());
  n.setUTCHours(0, 0, 0, 0);
  return new Date(n.getTime() + DAY_MS);
}
function setMinutesOfDay(d: Date, minutesOfDay: number): Date {
  const n = new Date(d.getTime());
  n.setUTCHours(0, 0, 0, 0);
  return new Date(n.getTime() + minutesOfDay * 60000);
}

export function computeDueAt(startAt: Date, minutes: number, businessHours: BusinessHours | null | undefined): Date {
  const days = businessHours?.days;
  const tz = businessHours?.tz;
  const hasSchedule = !!tz && !!days && Object.values(days).some((w) => Array.isArray(w));
  const wallClock = () => new Date(startAt.getTime() + minutes * 60000);
  if (!hasSchedule) return wallClock();

  const offset = tzOffsetMinutes(startAt, tz!);
  let cur = new Date(startAt.getTime() + offset * 60000); // hora de pared como pseudo-UTC
  let remaining = minutes;
  let safety = 0;

  while (remaining > 0) {
    if (safety++ > 400) return wallClock(); // guarda anti-loop (semana efectivamente cerrada)
    const win = days![String(cur.getUTCDay())];
    if (!Array.isArray(win)) { cur = atMidnightNextDay(cur); continue; }
    const [open, close] = win;
    const mod = cur.getUTCHours() * 60 + cur.getUTCMinutes();
    if (mod < open) { cur = setMinutesOfDay(cur, open); continue; }
    if (mod >= close) { cur = atMidnightNextDay(cur); continue; }
    const avail = close - mod;
    if (remaining <= avail) { cur = new Date(cur.getTime() + remaining * 60000); remaining = 0; }
    else { remaining -= avail; cur = atMidnightNextDay(cur); }
  }
  return new Date(cur.getTime() - offset * 60000); // pseudo-UTC → UTC real
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/workflows/business-hours.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/business-hours.ts src/lib/workflows/business-hours.test.ts
git commit -m "feat(sla): calculadora pura de minutos hábiles (computeDueAt)"
```

---

## Task 3: Selector de política por segmento (puro)

**Files:**
- Create: `src/lib/workflows/sla-select.ts`
- Test: `src/lib/workflows/sla-select.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import { selectSlaPolicy, type SlaPolicyLike } from "./sla-select";

const base: Omit<SlaPolicyLike, "id" | "name"> = { isActive: true, isDefault: false, priority: 100, conditions: {} };
const P = (id: string, over: Partial<SlaPolicyLike>): SlaPolicyLike => ({ ...base, id, name: id, ...over });
const brokerCond = { all: [{ field: "contact.contactType", op: "eq", value: "BROKER_EXTERNO" }] };

describe("selectSlaPolicy", () => {
  const def = P("def", { isDefault: true, priority: 999, conditions: {} });

  it("elige la política cuyo segmento cumple", () => {
    const seg = P("seg", { priority: 10, conditions: brokerCond });
    const r = selectSlaPolicy([def, seg], { contact: { contactType: "BROKER_EXTERNO" } });
    expect(r?.id).toBe("seg");
  });
  it("cae a la default cuando ningún segmento cumple", () => {
    const seg = P("seg", { priority: 10, conditions: brokerCond });
    const r = selectSlaPolicy([def, seg], { contact: { contactType: "COMPRADOR" } });
    expect(r?.id).toBe("def");
  });
  it("gana la de menor número de prioridad", () => {
    const a = P("a", { priority: 50, conditions: {} });
    const b = P("b", { priority: 10, conditions: {} });
    expect(selectSlaPolicy([def, a, b], {})?.id).toBe("b");
  });
  it("ignora inactivas", () => {
    const seg = P("seg", { priority: 1, isActive: false, conditions: brokerCond });
    const r = selectSlaPolicy([def, seg], { contact: { contactType: "BROKER_EXTERNO" } });
    expect(r?.id).toBe("def");
  });
  it("sin match y sin default → null", () => {
    const seg = P("seg", { priority: 10, conditions: brokerCond });
    expect(selectSlaPolicy([seg], { contact: { contactType: "COMPRADOR" } })).toBeNull();
  });
  it("la default no participa en la fase de match (solo como fallback)", () => {
    const d2 = P("d2", { isDefault: true, priority: 1, conditions: brokerCond });
    const seg = P("seg", { priority: 10, conditions: brokerCond });
    // ambas 'cumplen' broker, pero seg gana por ser no-default
    expect(selectSlaPolicy([d2, seg], { contact: { contactType: "BROKER_EXTERNO" } })?.id).toBe("seg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/workflows/sla-select.test.ts`
Expected: FAIL (import no resuelve).

- [ ] **Step 3: Implementar**

```ts
// src/lib/workflows/sla-select.ts
// Selección de política SLA por segmento. PURA (recibe políticas ya cargadas).
import { evaluateConditions } from "./evaluate-conditions";
import type { ConditionNode } from "@/lib/validations/rebuild-f1";

export interface SlaPolicyLike {
  id: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  priority: number;
  conditions: unknown;
}

export function selectSlaPolicy<T extends SlaPolicyLike>(policies: T[], ctx: Record<string, unknown>): T | null {
  const candidates = policies
    .filter((p) => p.isActive && !p.isDefault)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  for (const p of candidates) {
    if (evaluateConditions(p.conditions as ConditionNode | Record<string, never>, ctx)) return p;
  }
  return policies.find((p) => p.isActive && p.isDefault) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/workflows/sla-select.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/sla-select.ts src/lib/workflows/sla-select.test.ts
git commit -m "feat(sla): selector puro de política por segmento (selectSlaPolicy)"
```

---

## Task 4: Cablear `createSlaTimer` (contexto + selección + businessHours)

**Files:**
- Modify: `src/lib/workflows/sla.ts`
- Test: `src/lib/workflows/sla.createTimer.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const contact = vi.fn();
const findMany = vi.fn();
const timerFindFirst = vi.fn();
const timerCreate = vi.fn();
const contactUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contact(...a), update: (...a: unknown[]) => contactUpdate(...a) },
    slaPolicy: { findMany: (...a: unknown[]) => findMany(...a) },
    slaTimer: { findFirst: (...a: unknown[]) => timerFindFirst(...a), create: (...a: unknown[]) => timerCreate(...a) },
  },
}));

import { createSlaTimer } from "./sla";

const NOW = new Date("2026-07-09T20:00:00Z"); // jueves 15:00 Cancún

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  contact.mockReset(); findMany.mockReset(); timerFindFirst.mockReset(); timerCreate.mockReset(); contactUpdate.mockReset();
  timerFindFirst.mockResolvedValue(null);
  timerCreate.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

const seg = { id: "seg", name: "Broker", isActive: true, isDefault: false, priority: 10,
  conditions: { all: [{ field: "contact.contactType", op: "eq", value: "BROKER_EXTERNO" }] },
  firstTouchMinutes: 15, retryMinutes: 60, orphanHours: 48, businessHours: {} };
const def = { id: "def", name: "Default", isActive: true, isDefault: true, priority: 999,
  conditions: {}, firstTouchMinutes: 5, retryMinutes: 30, orphanHours: 24, businessHours: {} };

it("elige la política del segmento y usa sus minutos", async () => {
  contact.mockResolvedValue({ id: "c1", contactType: "BROKER_EXTERNO", adAttribution: null, assignedTo: { plaza: "TULUM" } });
  findMany.mockResolvedValue([def, seg]);
  await createSlaTimer("c1", "FIRST_TOUCH");
  const data = timerCreate.mock.calls[0][0].data;
  expect(data.policyId).toBe("seg");
  expect(data.dueAt.getTime()).toBe(NOW.getTime() + 15 * 60000);
});

it("regresión: default sin condiciones/horario == comportamiento actual (wall-clock)", async () => {
  contact.mockResolvedValue({ id: "c1", contactType: "COMPRADOR", adAttribution: null, assignedTo: { plaza: "TULUM" } });
  findMany.mockResolvedValue([def]);
  await createSlaTimer("c1", "RETRY");
  const data = timerCreate.mock.calls[0][0].data;
  expect(data.policyId).toBe("def");
  expect(data.dueAt.getTime()).toBe(NOW.getTime() + 30 * 60000);
});

it("ORPHAN usa wall-clock aunque la política tenga horario", async () => {
  const bh = { ...def, businessHours: { tz: "America/Cancun", days: { "4": [540, 1080] } } };
  contact.mockResolvedValue({ id: "c1", contactType: "COMPRADOR", adAttribution: null, assignedTo: null });
  findMany.mockResolvedValue([bh]);
  await createSlaTimer("c1", "ORPHAN");
  const data = timerCreate.mock.calls[0][0].data;
  expect(data.dueAt.getTime()).toBe(NOW.getTime() + 24 * 60 * 60000);
});

it("no duplica timer RUNNING del mismo tipo", async () => {
  contact.mockResolvedValue({ id: "c1", contactType: "COMPRADOR", adAttribution: null, assignedTo: null });
  findMany.mockResolvedValue([def]);
  timerFindFirst.mockResolvedValue({ id: "existing" });
  await createSlaTimer("c1", "FIRST_TOUCH");
  expect(timerCreate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/workflows/sla.createTimer.test.ts`
Expected: FAIL (createSlaTimer aún usa defaultPolicy / no expone policyId de segmento).

- [ ] **Step 3: Reescribir `sla.ts` (arriba del archivo, reemplazando `defaultPolicy` y `createSlaTimer`)**

```ts
// SlaEngine (Anexo Técnico §D.2/§D.7) — timers FIRST_TOUCH/RETRY/ORPHAN.
// Política elegida por segmento; vencimiento por minutos hábiles (excepto ORPHAN = wall-clock).
import prisma from "@/lib/db";
import { selectSlaPolicy } from "./sla-select";
import { computeDueAt, type BusinessHours } from "./business-hours";

// Contexto mínimo para el DSL de condiciones (contacto + attribution + plaza del asesor).
async function loadSlaContext(contactId: string): Promise<Record<string, unknown>> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { adAttribution: true, assignedTo: { select: { plaza: true } } },
  });
  return {
    contact,
    adAttribution: (contact as { adAttribution?: unknown } | null)?.adAttribution ?? null,
    plaza: (contact as { assignedTo?: { plaza?: unknown } } | null)?.assignedTo?.plaza ?? null,
  };
}

export async function createSlaTimer(
  contactId: string,
  type: "FIRST_TOUCH" | "RETRY" | "ORPHAN",
  dealId?: string
): Promise<void> {
  // No duplicar un timer RUNNING del mismo tipo para el mismo contacto
  const existing = await prisma.slaTimer.findFirst({
    where: { contactId, type, status: "RUNNING" },
    select: { id: true },
  });
  if (existing) return;

  const [ctx, policies] = await Promise.all([
    loadSlaContext(contactId),
    prisma.slaPolicy.findMany({ where: { isActive: true } }),
  ]);
  const policy = selectSlaPolicy(policies, ctx);

  const minutes =
    type === "FIRST_TOUCH" ? policy?.firstTouchMinutes ?? 5
    : type === "RETRY" ? policy?.retryMinutes ?? 30
    : (policy?.orphanHours ?? 24) * 60;

  const bh = type === "ORPHAN" ? null : ((policy?.businessHours as unknown as BusinessHours) ?? null);
  const dueAt = computeDueAt(new Date(), minutes, bh);

  await prisma.slaTimer.create({
    data: { contactId, dealId: dealId ?? null, policyId: policy?.id ?? null, type, dueAt },
  });
}
```
> Deja intactas `meetSlaTimers` y `checkSlaBreaches` (más abajo en el archivo). `selectSlaPolicy` acepta el shape de `SlaPolicy` (tiene `id/name/isActive/isDefault/priority/conditions`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/workflows/sla.createTimer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/sla.ts src/lib/workflows/sla.createTimer.test.ts
git commit -m "feat(sla): createSlaTimer elige política por segmento + aplica minutos hábiles"
```

---

## Task 5: API CRUD de políticas + zod

**Files:**
- Create: `src/lib/workflows/sla-model.ts`, `src/lib/workflows/sla-model.test.ts`
- Create: `src/app/api/admin/automation/sla/route.ts`, `src/app/api/admin/automation/sla/[id]/route.ts`

- [ ] **Step 1: Escribir el test de zod que falla**

```ts
import { describe, it, expect } from "vitest";
import { slaPolicyInputSchema } from "./sla-model";

const ok = { name: "Broker MX", firstTouchMinutes: 15, retryMinutes: 60, orphanHours: 48 };

describe("slaPolicyInputSchema", () => {
  it("acepta mínimo válido con defaults", () => {
    const r = slaPolicyInputSchema.parse(ok);
    expect(r.priority).toBe(100);
    expect(r.conditions).toEqual({});
    expect(r.businessHours).toEqual({});
    expect(r.isActive).toBe(true);
  });
  it("acepta businessHours válido", () => {
    const r = slaPolicyInputSchema.parse({ ...ok, businessHours: { tz: "America/Cancun", days: { "1": [540, 1080], "0": null } } });
    expect((r.businessHours as { days: unknown }).days).toBeDefined();
  });
  it("rechaza apertura >= cierre", () => {
    expect(slaPolicyInputSchema.safeParse({ ...ok, businessHours: { tz: "America/Cancun", days: { "1": [1080, 540] } } }).success).toBe(false);
  });
  it("rechaza conditions con forma inválida", () => {
    expect(slaPolicyInputSchema.safeParse({ ...ok, conditions: { bogus: 1 } }).success).toBe(false);
  });
  it("rechaza minutos fuera de rango", () => {
    expect(slaPolicyInputSchema.safeParse({ ...ok, firstTouchMinutes: 0 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/workflows/sla-model.test.ts`
Expected: FAIL (import no resuelve).

- [ ] **Step 3: Implementar `sla-model.ts`**

```ts
// src/lib/workflows/sla-model.ts
import { z } from "zod";
import { conditionsDslSchema } from "@/lib/validations/rebuild-f1";

const timeTuple = z
  .tuple([z.number().int().min(0).max(1440), z.number().int().min(0).max(1440)])
  .refine(([open, close]) => open < close, { message: "apertura debe ser menor que cierre" });

export const businessHoursSchema = z.union([
  z.object({}).strict(), // vacío = wall-clock
  z.object({
    tz: z.string().min(1),
    days: z.record(z.enum(["0", "1", "2", "3", "4", "5", "6"]), timeTuple.nullable()),
  }).strict(),
]);

export const slaPolicyInputSchema = z.object({
  name: z.string().min(1).max(120),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  priority: z.number().int().min(0).max(1000).default(100),
  conditions: conditionsDslSchema.default({}),
  firstTouchMinutes: z.number().int().min(1).max(1440),
  retryMinutes: z.number().int().min(1).max(1440),
  orphanHours: z.number().int().min(1).max(720),
  businessHours: businessHoursSchema.default({}),
});

export type SlaPolicyInput = z.infer<typeof slaPolicyInputSchema>;
```

- [ ] **Step 4: Run zod test — PASS**

Run: `npx vitest run src/lib/workflows/sla-model.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Implementar `sla/route.ts` (POST)**

Espeja `plans/route.ts` (RBAC `["ADMIN","DIRECTOR"]`, `getServerSession`, auditLog, P2002→409).
```ts
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { slaPolicyInputSchema } from "@/lib/workflows/sla-model";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const parsed = slaPolicyInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  let policy;
  try {
    policy = await prisma.$transaction(async (tx) => {
      if (d.isDefault) await tx.slaPolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.slaPolicy.create({
        data: {
          name: d.name, isActive: d.isActive, isDefault: d.isDefault, priority: d.priority,
          conditions: d.conditions as object, businessHours: d.businessHours as object,
          firstTouchMinutes: d.firstTouchMinutes, retryMinutes: d.retryMinutes, orphanHours: d.orphanHours,
        },
      });
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return NextResponse.json({ error: "Ya existe una política con ese nombre" }, { status: 409 });
    throw e;
  }
  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "CREATE", entity: "SlaPolicy", entityId: policy.id, changes: JSON.parse(JSON.stringify(d)) },
  });
  return NextResponse.json({ data: policy }, { status: 201 });
}
```

- [ ] **Step 6: Implementar `sla/[id]/route.ts` (PUT + DELETE)**

```ts
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { slaPolicyInputSchema } from "@/lib/workflows/sla-model";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = slaPolicyInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  let policy;
  try {
    policy = await prisma.$transaction(async (tx) => {
      const exists = await tx.slaPolicy.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw { code: "P2025" };
      if (d.isDefault) await tx.slaPolicy.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
      return tx.slaPolicy.update({
        where: { id },
        data: {
          name: d.name, isActive: d.isActive, isDefault: d.isDefault, priority: d.priority,
          conditions: d.conditions as object, businessHours: d.businessHours as object,
          firstTouchMinutes: d.firstTouchMinutes, retryMinutes: d.retryMinutes, orphanHours: d.orphanHours,
        },
      });
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P2002") return NextResponse.json({ error: "Ya existe una política con ese nombre" }, { status: 409 });
    if (code === "P2025") return NextResponse.json({ error: "Política no encontrada" }, { status: 404 });
    throw e;
  }
  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "UPDATE", entity: "SlaPolicy", entityId: id, changes: JSON.parse(JSON.stringify(d)) },
  });
  return NextResponse.json({ data: policy }, { status: 200 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const target = await prisma.slaPolicy.findUnique({ where: { id }, select: { isDefault: true } });
  if (!target) return NextResponse.json({ error: "Política no encontrada" }, { status: 404 });
  if (target.isDefault) return NextResponse.json({ error: "No se puede borrar la política default" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.slaTimer.updateMany({ where: { policyId: id }, data: { policyId: null } });
    await tx.slaPolicy.delete({ where: { id } });
  });
  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "DELETE", entity: "SlaPolicy", entityId: id, changes: {} },
  });
  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 7: Verificar tipos y commit**

Run: `npx tsc --noEmit` (esperar 0 errores nuevos; los 2 pre-existentes en `builder-model.test.ts` son ajenos).
```bash
git add src/lib/workflows/sla-model.ts src/lib/workflows/sla-model.test.ts src/app/api/admin/automation/sla/
git commit -m "feat(sla): API CRUD de políticas (POST/PUT/DELETE) + zod businessHours"
```

---

## Task 6: UI — editor de políticas SLA

**Files:**
- Create: `src/components/config/sla-policy-editor.tsx`
- Modify: `src/components/config/automation-section.tsx`

**Referencias a leer antes:** `src/components/config/cadence-editor.tsx` (uso de `ConditionTreeEditor` desde `condition-tree.tsx`, patrón lista+form, llamadas fetch POST/PUT/DELETE) y la sección SLA actual de `automation-section.tsx` (~líneas 300-340).

- [ ] **Step 1: Extender la interface `Sla` en `automation-section.tsx`**

Añadir a `interface Sla`:
```ts
  retryMinutes: number;      // (ya existe)
  orphanHours: number;       // (ya existe)
  isActive: boolean;
  priority: number;
  conditions: unknown;
  businessHours: unknown;
```
(Asegura que `isActive`, `priority`, `conditions`, `businessHours` estén presentes; ya vienen del GET porque el findMany no usa `select`.)

- [ ] **Step 2: Crear `sla-policy-editor.tsx`**

Componente cliente con:
- Prop: `{ policies: Sla[]; canEdit: boolean; onChanged: () => void }`.
- Lista de políticas (nombre, badge `default`, prioridad, nº timers) + botón "Nueva política" (solo `canEdit`).
- Form (modal o inline) por política con: `name` (text), `isActive` (Switch), `isDefault` (checkbox), `priority` (number), **`ConditionTreeEditor`** (reusar tal como `cadence-editor.tsx`; ocultarlo si `isDefault` con nota "la default aplica cuando ningún segmento cumple"), `firstTouchMinutes`/`retryMinutes` (min) + `orphanHours` (hrs), y **editor de horario**:
  - Input `tz` (default `"America/Cancun"`).
  - 7 filas (Dom…Sáb): checkbox "Abierto" + dos `<input type="time">` (apertura/cierre). Conversión `"HH:MM"` ↔ minutos: `min = h*60+m`; `hhmm = String(Math.floor(min/60)).padStart(2,"0")+":"+String(min%60).padStart(2,"0")`. Día cerrado → `null`.
  - Serializa a `{ tz, days: { "0": [o,c] | null, ... } }`; si ninguna abierta, envía `{}`.
- Guardar: `POST /api/admin/automation/sla` (nueva) o `PUT /api/admin/automation/sla/{id}` (edición). Borrar: `DELETE` con confirm (deshabilitar en la default). Tras éxito → `onChanged()`.
- Manejar errores 400/409/403 mostrando el mensaje del body.

- [ ] **Step 3: Montar en `automation-section.tsx`**

Reemplaza el bloque actual "Políticas SLA (speed-to-lead)" (el `slas.map` con solo los 3 inputs + patch) por:
```tsx
<SlaPolicyEditor policies={slas} canEdit={canEdit} onChanged={load} />
```
Importa `SlaPolicyEditor` arriba. Mantén el `import` y helper `patch` para rules/plans. Elimina el `slaDraft` state si queda sin uso.

- [ ] **Step 4: Verificar build + tipos**

Run: `npx tsc --noEmit && npm run build`
Expected: build verde (0 errores nuevos).

- [ ] **Step 5: Commit**

```bash
git add src/components/config/sla-policy-editor.tsx src/components/config/automation-section.tsx
git commit -m "feat(sla): editor de políticas SLA por segmento + horario en /configuracion"
```

---

## Task 7: Verificación final

- [ ] **Step 1: Suite completa**

Run: `npx vitest run`
Expected: baseline (423) + nuevos (≈23) verdes; 0 rojos.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: verde (salvo los 2 errores PRE-existentes de `builder-model.test.ts`, si aplica solo a tsc de tests).

- [ ] **Step 3: Confirmar migración lista (no aplicada)**

Verifica que `prisma/migrations-manual/2026-07-09-sla-por-segmento.sql` existe y es aditivo. **NO aplicar** — la aplica Luis con frase de autorización antes del deploy.

- [ ] **Step 4: Resumen para review + handoff a Luis** (migración + push pendientes de autorización).

---

## Self-Review (cobertura vs spec)

- Modelo `conditions`+`priority` → Task 1. ✅
- `businessHours` shape + wall-clock fallback → Task 2 (+ zod Task 5). ✅
- Selección por DSL+prioridad, default fallback → Task 3. ✅
- Orquestación (contexto+plaza, minutos por tipo, ORPHAN wall-clock, anti-dup) → Task 4. ✅
- API POST/PUT/DELETE + isDefault único + 404/409 + RBAC → Task 5. ✅
- UI lista+editor+ConditionTreeEditor+horario → Task 6. ✅
- Tests de cada unidad + regresión "default==hoy" → Tasks 2-5. ✅
- Migración a BD compartida = autorización de Luis → Tasks 1/7. ✅

Sin placeholders. Nombres consistentes (`computeDueAt`, `selectSlaPolicy`, `slaPolicyInputSchema`, `businessHoursSchema`, `loadSlaContext`, `SlaPolicyLike`). `days` con claves `"0".."6"` (0=domingo) consistente en calculadora, zod y UI.
```
