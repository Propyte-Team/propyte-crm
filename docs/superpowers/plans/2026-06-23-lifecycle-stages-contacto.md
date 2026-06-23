# Lifecycle Stages del Contacto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalizar el ciclo de vida del comprador/inversionista como un eje propio del contacto (`LifecycleStage`, 7 etapas tipo HubSpot), con transiciones híbridas (auto forward-only + override manual), integrado al motor de workflows y a la UI.

**Architecture:** Enum `LifecycleStage` + `Contact.lifecycleStage` nullable. `ContactType` se repropone a categoría (paso-1 aditivo). Un helper puro (`src/lib/lifecycle/`) decide transiciones; `applyLifecycleTransition` las aplica emitiendo `contact.lifecycle_changed` + `Activity`. El auto-avance se engancha en `processEvent` del motor. El builder gana trigger `LIFECYCLE_CHANGE`, condición `contact.lifecycleStage` y acción `SET_LIFECYCLE`. UI: stepper en detalle + badge/filtro en lista.

**Tech Stack:** Next.js 14, Prisma (schema `propyte_crm` en Supabase `oaijxdpevakashxshhvm`), TypeScript, vitest, React/Tailwind.

**Reglas del repo:** worktree aislado `worktree-crm-lifecycle-stages`. Autor git = `Propyte-Luis <webkoi@webkoi-ai.com>` (verificar antes de cada commit). Test runner: `npx vitest run <ruta>`. **La migración NO se aplica** a la BD sin la frase explícita de Luis (`"aplica la migración lifecycle"`); se deja preparada y verificada.

---

## File Structure

- `prisma/schema.prisma` — MODIFY: enum `LifecycleStage` (nuevo), `Contact.lifecycleStage`, `ContactType += COMPRADOR/REFERIDOR`, `TriggerType += LIFECYCLE_CHANGE`, `WorkflowActionType += SET_LIFECYCLE`.
- `prisma/migrations-manual/2026-06-23-lifecycle-stages.sql` — CREATE: migración aditiva + backfill (preparada, no aplicada).
- `src/lib/constants.ts` — MODIFY: `LIFECYCLE_ORDER`, `LIFECYCLE_LABELS`, `LIFECYCLE_COLORS`, actualizar `CONTACT_TYPE_LABELS`.
- `src/lib/lifecycle/transitions.ts` — CREATE: lógica pura (índice, forward-only, decisión por señal).
- `src/lib/lifecycle/transitions.test.ts` — CREATE.
- `src/lib/lifecycle/apply.ts` — CREATE: `applyLifecycleTransition` (efectos: update + evento + Activity) + `maybeAdvanceLifecycleFromEvent`.
- `src/lib/lifecycle/apply.test.ts` — CREATE.
- `src/lib/workflows/engine.ts` — MODIFY: llamar `maybeAdvanceLifecycleFromEvent` en `processEvent`; `matchesTrigger` soporta `LIFECYCLE_CHANGE`.
- `src/lib/workflows/actions.ts` — MODIFY: case `SET_LIFECYCLE`; actualizar enum `contactType` del whitelist.
- `src/lib/workflows/builder-model.ts` — MODIFY: `LIFECYCLE_CHANGE` en `buildTriggerConfig`/`parseTriggerValue`; `contact.lifecycleStage` en `FIELD_SUGGESTIONS`.
- `src/lib/workflows/builder-model.test.ts` — MODIFY: tests del trigger.
- `src/app/api/contacts/route.ts` — MODIFY: zod acepta `lifecycleStage`; filtro `lifecycleStage`; override manual emite transición.
- `src/components/contacts/lifecycle-stepper.tsx` — CREATE: stepper visual.
- `src/components/contacts/contact-detail.tsx` — MODIFY: integrar stepper.
- `src/components/contacts/contacts-list.tsx` — MODIFY: badge + filtro de lifecycle.

---

## Task 1: Schema Prisma + enums (sin aplicar a BD)

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Agregar enum `LifecycleStage`** (junto a los demás enums, antes de `@@schema`-less area; pegar tras `enum ContactStatus { ... }`)

```prisma
enum LifecycleStage {
  SUSCRIPTOR
  LEAD
  MQL
  SQL
  OPORTUNIDAD
  CLIENTE
  EMBAJADOR

  @@schema("propyte_crm")
}
```

- [ ] **Step 2: Agregar valores a `ContactType`** (editar el enum existente — paso-1 aditivo; NO borrar LEAD/PROSPECTO/CLIENTE todavía)

```prisma
enum ContactType {
  LEAD
  PROSPECTO
  CLIENTE
  INVERSIONISTA
  BROKER_EXTERNO
  REFERIDO
  EMPLEO
  COMPRADOR
  REFERIDOR

  @@schema("propyte_crm")
}
```

- [ ] **Step 3: Agregar campo a `model Contact`** (tras la línea `contactStatus ... @default(NUEVO)`)

```prisma
  lifecycleStage    LifecycleStage?
```

- [ ] **Step 4: Agregar `LIFECYCLE_CHANGE` a `TriggerType`** (editar enum existente)

```prisma
enum TriggerType {
  EVENT
  TIME
  BEHAVIORAL
  INACTIVITY
  STAGE_CHANGE
  SLA_BREACH
  SCORE_THRESHOLD
  LIFECYCLE_CHANGE

  @@schema("propyte_crm")
}
```

- [ ] **Step 5: Agregar `SET_LIFECYCLE` a `WorkflowActionType`** (editar enum existente; agregar tras `CHANGE_STAGE`)

```prisma
  CHANGE_STAGE
  SET_LIFECYCLE
```

- [ ] **Step 6: Validar que el schema parsea (sin tocar BD)**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 7: Regenerar el cliente Prisma (local, sin DB push)**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" sin errores. (Esto hace que los tipos `LifecycleStage`, `Contact.lifecycleStage`, etc. existan para TypeScript.)

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(lifecycle): enum LifecycleStage + Contact.lifecycleStage + LIFECYCLE_CHANGE/SET_LIFECYCLE (schema)"
```

---

## Task 2: SQL de migración aditiva (preparada, NO aplicar)

**Files:**
- Create: `prisma/migrations-manual/2026-06-23-lifecycle-stages.sql`

- [ ] **Step 1: Escribir el SQL** (aditivo; `ADD VALUE` en statements separados — no pueden usarse en la misma transacción que su uso; backfill idempotente)

```sql
-- Migración aditiva — Lifecycle Stages del contacto (Fase 3 sub-A).
-- Aplicar vía MCP Supabase en oaijxdpevakashxshhvm SOLO con autorización explícita.
-- Paso-1: agrega enum/columna/valores y backfilea. El retiro de LEAD/PROSPECTO/CLIENTE
-- de ContactType es PASO-2 (sesión posterior), NO aquí.

-- 1) Enum nuevo LifecycleStage
DO $$ BEGIN
  CREATE TYPE propyte_crm."LifecycleStage" AS ENUM
    ('SUSCRIPTOR','LEAD','MQL','SQL','OPORTUNIDAD','CLIENTE','EMBAJADOR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Columna nullable en Contact
ALTER TABLE propyte_crm."Contact"
  ADD COLUMN IF NOT EXISTS "lifecycleStage" propyte_crm."LifecycleStage";

-- 3) Nuevos valores de ContactType (cada ADD VALUE en su propio statement; idempotente)
ALTER TYPE propyte_crm."ContactType" ADD VALUE IF NOT EXISTS 'COMPRADOR';
ALTER TYPE propyte_crm."ContactType" ADD VALUE IF NOT EXISTS 'REFERIDOR';

-- 4) Trigger/Action enums
ALTER TYPE propyte_crm."TriggerType" ADD VALUE IF NOT EXISTS 'LIFECYCLE_CHANGE';
ALTER TYPE propyte_crm."WorkflowActionType" ADD VALUE IF NOT EXISTS 'SET_LIFECYCLE';
```

> NOTA AL APLICAR: por la regla de Postgres "unsafe use of new enum value", los pasos 3–4 (ADD VALUE) deben **commitearse antes** de usarse. El backfill (abajo) usa los valores nuevos, así que va en una **ejecución/transacción separada** (segundo bloque). Por eso el archivo se aplica en 2 envíos vía MCP.

- [ ] **Step 2: Escribir el backfill** (segundo bloque del mismo archivo, separado por comentario marcador)

```sql
-- ===== APLICAR EN SEGUNDA EJECUCIÓN (tras commitear los ADD VALUE) =====
-- Backfill idempotente: solo toca filas aún en el esquema viejo.

-- Compradores con deal ganado → CLIENTE; el resto según su contactType viejo.
UPDATE propyte_crm."Contact" c SET "lifecycleStage" = 'CLIENTE'
  WHERE c."contactType" IN ('CLIENTE')
    AND c."lifecycleStage" IS NULL;

UPDATE propyte_crm."Contact" c SET "lifecycleStage" = 'SQL'
  WHERE c."contactType" = 'PROSPECTO' AND c."lifecycleStage" IS NULL;

UPDATE propyte_crm."Contact" c SET "lifecycleStage" = 'LEAD'
  WHERE c."contactType" = 'LEAD' AND c."lifecycleStage" IS NULL;

-- Inversionistas: CLIENTE si tienen deal ganado, si no LEAD.
UPDATE propyte_crm."Contact" c SET "lifecycleStage" =
  CASE WHEN EXISTS (
    SELECT 1 FROM propyte_crm."Deal" d
    WHERE d."contactId" = c.id AND d."actualCloseDate" IS NOT NULL
  ) THEN 'CLIENTE' ELSE 'LEAD' END
  WHERE c."contactType" = 'INVERSIONISTA' AND c."lifecycleStage" IS NULL;

-- Recategorizar: LEAD/PROSPECTO/CLIENTE → COMPRADOR; REFERIDO → REFERIDOR.
UPDATE propyte_crm."Contact" SET "contactType" = 'COMPRADOR'
  WHERE "contactType" IN ('LEAD','PROSPECTO','CLIENTE');
UPDATE propyte_crm."Contact" SET "contactType" = 'REFERIDOR'
  WHERE "contactType" = 'REFERIDO';
-- BROKER_EXTERNO, EMPLEO, INVERSIONISTA se quedan igual; su lifecycle queda NULL salvo INVERSIONISTA.
```

- [ ] **Step 3: Verificar el SQL en seco (no aplicar)** — leerlo, confirmar que cada `UPDATE` tiene guard `IS NULL`/valor viejo (idempotente) y que no hay DELETE/DROP.

Run: `grep -iE "drop|delete|truncate" prisma/migrations-manual/2026-06-23-lifecycle-stages.sql`
Expected: sin resultados (cero statements destructivos).

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations-manual/2026-06-23-lifecycle-stages.sql
git commit -m "feat(lifecycle): SQL de migración aditiva + backfill (preparada, sin aplicar)"
```

---

## Task 3: Helper puro de transiciones

**Files:**
- Create: `src/lib/lifecycle/transitions.ts`
- Test: `src/lib/lifecycle/transitions.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from "vitest";
import {
  LIFECYCLE_ORDER, stageIndex, isForward, candidateStageForSignal,
} from "./transitions";

describe("lifecycle transitions (pure)", () => {
  it("orden canónico de 7 etapas", () => {
    expect(LIFECYCLE_ORDER).toEqual([
      "SUSCRIPTOR","LEAD","MQL","SQL","OPORTUNIDAD","CLIENTE","EMBAJADOR",
    ]);
  });

  it("stageIndex: null = -1, primera = 0", () => {
    expect(stageIndex(null)).toBe(-1);
    expect(stageIndex("SUSCRIPTOR")).toBe(0);
    expect(stageIndex("CLIENTE")).toBe(5);
  });

  it("isForward: avanza solo hacia adelante; null→cualquiera es forward", () => {
    expect(isForward(null, "LEAD")).toBe(true);
    expect(isForward("LEAD", "MQL")).toBe(true);
    expect(isForward("MQL", "LEAD")).toBe(false);
    expect(isForward("CLIENTE", "CLIENTE")).toBe(false);
  });

  it("candidateStageForSignal mapea señal→etapa", () => {
    expect(candidateStageForSignal("whatsapp.replied", { score: 0 }, 70)).toBe("MQL");
    expect(candidateStageForSignal("contact.scored", { score: 80 }, 70)).toBe("SQL");
    expect(candidateStageForSignal("contact.scored", { score: 40 }, 70)).toBe("MQL");
    expect(candidateStageForSignal("deal.created", { score: 0 }, 70)).toBe("OPORTUNIDAD");
    expect(candidateStageForSignal("deal.won", { score: 0 }, 70)).toBe("CLIENTE");
    expect(candidateStageForSignal("sla.breach", { score: 0 }, 70)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `npx vitest run src/lib/lifecycle/transitions.test.ts`
Expected: FAIL ("Cannot find module './transitions'").

- [ ] **Step 3: Implementar `transitions.ts`**

```ts
// Lógica pura del lifecycle del contacto. Sin BD, sin I/O → testeable.
import type { LifecycleStage } from "@prisma/client";

export const LIFECYCLE_ORDER: LifecycleStage[] = [
  "SUSCRIPTOR", "LEAD", "MQL", "SQL", "OPORTUNIDAD", "CLIENTE", "EMBAJADOR",
];

export function stageIndex(stage: LifecycleStage | null | undefined): number {
  if (!stage) return -1;
  return LIFECYCLE_ORDER.indexOf(stage);
}

/** Forward-only: destino debe ser posterior. null (sin etapa) → cualquier etapa es forward. */
export function isForward(
  from: LifecycleStage | null | undefined,
  to: LifecycleStage,
): boolean {
  return stageIndex(to) > stageIndex(from ?? null);
}

/** Mapea una señal de dominio + estado del contacto a la etapa candidata (o null si no aplica). */
export function candidateStageForSignal(
  signal: string,
  contact: { score: number },
  qualifiedThreshold: number,
): LifecycleStage | null {
  switch (signal) {
    case "deal.won":
      return "CLIENTE";
    case "deal.created":
    case "deal.stage_changed":
      return "OPORTUNIDAD";
    case "contact.scored":
      return contact.score >= qualifiedThreshold ? "SQL"
        : contact.score >= Math.ceil(qualifiedThreshold / 2) ? "MQL"
        : null;
    case "whatsapp.replied":
    case "lead.captured":
      return "MQL";
    default:
      return null;
  }
}
```

- [ ] **Step 4: Correr el test, verificar que pasa**

Run: `npx vitest run src/lib/lifecycle/transitions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/lifecycle/transitions.ts src/lib/lifecycle/transitions.test.ts
git commit -m "feat(lifecycle): helper puro de transiciones (orden, forward-only, señal→etapa)"
```

---

## Task 4: Aplicar transición (efectos: update + evento + Activity)

**Files:**
- Create: `src/lib/lifecycle/apply.ts`
- Test: `src/lib/lifecycle/apply.test.ts`

- [ ] **Step 1: Escribir el test que falla** (mockea prisma y emitEvent)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const activityCreateMock = vi.fn();
const emitMock = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: { update: (...a: unknown[]) => updateMock(...a) },
    activity: { create: (...a: unknown[]) => activityCreateMock(...a) },
  },
}));
vi.mock("@/lib/workflows/events", () => ({
  emitEvent: (...a: unknown[]) => emitMock(...a),
}));

import { applyLifecycleTransition } from "./apply";

beforeEach(() => { updateMock.mockReset(); activityCreateMock.mockReset(); emitMock.mockReset(); });

describe("applyLifecycleTransition", () => {
  it("avanza, persiste, emite evento y escribe Activity", async () => {
    const res = await applyLifecycleTransition({
      contactId: "c1", from: "LEAD", to: "MQL", actorUserId: "u1", auto: false,
    });
    expect(res.applied).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "c1" }, data: { lifecycleStage: "MQL" } });
    expect(emitMock).toHaveBeenCalledWith("contact.lifecycle_changed", "contact", "c1",
      expect.objectContaining({ fromStage: "LEAD", toStage: "MQL" }));
    expect(activityCreateMock).toHaveBeenCalled();
  });

  it("auto NO retrocede (skip sin efectos)", async () => {
    const res = await applyLifecycleTransition({
      contactId: "c1", from: "CLIENTE", to: "MQL", auto: true,
    });
    expect(res.applied).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("manual SÍ puede retroceder", async () => {
    const res = await applyLifecycleTransition({
      contactId: "c1", from: "CLIENTE", to: "MQL", actorUserId: "u1", auto: false,
    });
    expect(res.applied).toBe(true);
    expect(updateMock).toHaveBeenCalled();
  });

  it("no-op si from === to", async () => {
    const res = await applyLifecycleTransition({ contactId: "c1", from: "MQL", to: "MQL", auto: false });
    expect(res.applied).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test, verificar que falla**

Run: `npx vitest run src/lib/lifecycle/apply.test.ts`
Expected: FAIL ("Cannot find module './apply'").

- [ ] **Step 3: Implementar `apply.ts`**

```ts
import prisma from "@/lib/db";
import type { LifecycleStage } from "@prisma/client";
import { emitEvent } from "@/lib/workflows/events";
import { isForward, candidateStageForSignal, stageIndex } from "./transitions";

export interface ApplyArgs {
  contactId: string;
  from: LifecycleStage | null | undefined;
  to: LifecycleStage;
  actorUserId?: string | null;
  auto: boolean; // true = auto (forward-only); false = override manual (cualquier dirección)
}

export interface ApplyResult { applied: boolean; note?: string }

export async function applyLifecycleTransition(args: ApplyArgs): Promise<ApplyResult> {
  const { contactId, from, to, actorUserId, auto } = args;
  if (from === to) return { applied: false, note: "Sin cambio" };
  if (auto && !isForward(from, to)) return { applied: false, note: "Auto no retrocede" };

  await prisma.contact.update({ where: { id: contactId }, data: { lifecycleStage: to } });

  if (actorUserId) {
    await prisma.activity.create({
      data: {
        contactId,
        userId: actorUserId,
        activityType: "NOTE",
        subject: `Lifecycle: ${from ?? "—"} → ${to}`,
        description: auto ? "Avance automático del ciclo de vida" : "Cambio manual de etapa",
        status: "COMPLETADA",
      },
    });
  }

  await emitEvent("contact.lifecycle_changed", "contact", contactId, {
    fromStage: from ?? null, toStage: to, auto,
  });

  return { applied: true };
}

/** Engancha auto-avance a un evento de dominio. Devuelve la etapa nueva si avanzó. */
export async function maybeAdvanceLifecycleFromEvent(
  signal: string,
  contact: { id: string; score: number; contactType: string; lifecycleStage: LifecycleStage | null },
  qualifiedThreshold: number,
): Promise<LifecycleStage | null> {
  // Solo compradores/inversionistas tienen lifecycle.
  if (!["COMPRADOR", "INVERSIONISTA"].includes(contact.contactType)) return null;
  const candidate = candidateStageForSignal(signal, contact, qualifiedThreshold);
  if (!candidate) return null;
  const res = await applyLifecycleTransition({
    contactId: contact.id, from: contact.lifecycleStage, to: candidate, auto: true,
  });
  return res.applied ? candidate : null;
}
```

> NOTA: `activityType: "NOTE"` y `status: "COMPLETADA"` deben existir en los enums `ActivityType`/`ActivityStatus`. Verificar en `schema.prisma`; si el valor de status difiere (p.ej. `DONE`), usar el real. (`NOTE` ya se usa en `actions.ts`.)

- [ ] **Step 4: Verificar `ActivityStatus`** antes de correr

Run: `grep -nE "enum ActivityStatus" -A8 prisma/schema.prisma`
Expected: confirmar el valor de "completada"; ajustar el string en `apply.ts` si no es `COMPLETADA`.

- [ ] **Step 5: Correr el test, verificar que pasa**

Run: `npx vitest run src/lib/lifecycle/apply.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/lifecycle/apply.ts src/lib/lifecycle/apply.test.ts
git commit -m "feat(lifecycle): applyLifecycleTransition + maybeAdvanceLifecycleFromEvent (evento+Activity)"
```

---

## Task 5: Enganchar auto-avance en el motor + trigger LIFECYCLE_CHANGE

**Files:**
- Modify: `src/lib/workflows/engine.ts`
- Test: `src/lib/workflows/engine.ts` ya tiene cobertura; agregar caso a `src/lib/workflows/lifecycle-engine.test.ts` (CREATE)

- [ ] **Step 1: Leer `processEvent` y `matchesTrigger`**

Run: `sed -n '10,110p' src/lib/workflows/engine.ts`
Expected: ver `matchesTrigger` (case STAGE_CHANGE en líneas ~16-19) y `processEvent` (carga evento, buildContext, evalúa reglas).

- [ ] **Step 2: Escribir test que falla** — `LIFECYCLE_CHANGE` matchea por `toStage`

`src/lib/workflows/lifecycle-engine.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { matchesTrigger } from "./engine";

describe("matchesTrigger LIFECYCLE_CHANGE", () => {
  it("matchea cuando toStage coincide", () => {
    const rule = { triggerType: "LIFECYCLE_CHANGE" as const, triggerConfig: { toStage: "MQL" } };
    expect(matchesTrigger(rule, { type: "contact.lifecycle_changed", payload: { toStage: "MQL" } })).toBe(true);
    expect(matchesTrigger(rule, { type: "contact.lifecycle_changed", payload: { toStage: "SQL" } })).toBe(false);
  });
  it("matchea cualquier toStage si no se especifica en la regla", () => {
    const rule = { triggerType: "LIFECYCLE_CHANGE" as const, triggerConfig: {} };
    expect(matchesTrigger(rule, { type: "contact.lifecycle_changed", payload: { toStage: "MQL" } })).toBe(true);
  });
});
```

- [ ] **Step 3: Correr, verificar que falla**

Run: `npx vitest run src/lib/workflows/lifecycle-engine.test.ts`
Expected: FAIL (LIFECYCLE_CHANGE no matchea; cae al default).

- [ ] **Step 4: Implementar `matchesTrigger` para LIFECYCLE_CHANGE** — en `engine.ts`, dentro del `switch` de `matchesTrigger`, agregar tras el `case "STAGE_CHANGE"`:

```ts
    case "LIFECYCLE_CHANGE":
      return (
        event.type === "contact.lifecycle_changed" &&
        (cfg.toStage === undefined || (payload as { toStage?: string }).toStage === cfg.toStage)
      );
```

(Usar el mismo patrón/typing que el `case "STAGE_CHANGE"` existente; `cfg` y `payload` ya están en scope.)

- [ ] **Step 5: Enganchar el auto-avance en `processEvent`** — tras `const ctx = await buildContext(event);` (y antes de evaluar las reglas), agregar:

```ts
    // Auto-avance del lifecycle del contacto (forward-only) según la señal del evento.
    const c = ctx.contact as { id: string; score: number; contactType: string; lifecycleStage: import("@prisma/client").LifecycleStage | null } | null;
    if (c?.id && event.type !== "contact.lifecycle_changed") {
      const { maybeAdvanceLifecycleFromEvent } = await import("@/lib/lifecycle/apply");
      const { getQualifiedThreshold } = await import("@/lib/lifecycle/threshold");
      await maybeAdvanceLifecycleFromEvent(event.type, c, await getQualifiedThreshold()).catch((e) =>
        console.error("[lifecycle] auto-advance:", e));
    }
```

> El guard `event.type !== "contact.lifecycle_changed"` evita recursión (la transición emite ese evento).

- [ ] **Step 6: Crear `src/lib/lifecycle/threshold.ts`** (lee SystemConfig, default 70)

```ts
import prisma from "@/lib/db";

export async function getQualifiedThreshold(): Promise<number> {
  const row = await prisma.systemConfig.findUnique({ where: { key: "capi.qualified_score_threshold" } }).catch(() => null);
  const n = row ? Number((row as { value?: unknown }).value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 70;
}
```

> Verificar el nombre del modelo/columnas de SystemConfig: `grep -nE "model SystemConfig" -A8 prisma/schema.prisma`. Ajustar `key`/`value` a los campos reales.

- [ ] **Step 7: Correr test + typecheck**

Run: `npx vitest run src/lib/workflows/lifecycle-engine.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/workflows/engine.ts src/lib/workflows/lifecycle-engine.test.ts src/lib/lifecycle/threshold.ts
git commit -m "feat(lifecycle): trigger LIFECYCLE_CHANGE + auto-avance enganchado en processEvent"
```

---

## Task 6: Acción SET_LIFECYCLE + actualizar whitelist contactType

**Files:**
- Modify: `src/lib/workflows/actions.ts`
- Test: `src/lib/workflows/set-lifecycle-action.test.ts` (CREATE)

- [ ] **Step 1: Escribir test que falla**

`src/lib/workflows/set-lifecycle-action.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const applyMock = vi.fn().mockResolvedValue({ applied: true });
const contactFind = vi.fn().mockResolvedValue({ id: "c1", lifecycleStage: "LEAD", assignedToId: "u1" });

vi.mock("@/lib/db", () => ({
  default: { contact: { findUnique: (...a: unknown[]) => contactFind(...a) } },
}));
vi.mock("@/lib/lifecycle/apply", () => ({ applyLifecycleTransition: (...a: unknown[]) => applyMock(...a) }));

import { executeAction } from "./actions";

beforeEach(() => { applyMock.mockClear(); });

describe("SET_LIFECYCLE action", () => {
  it("invoca applyLifecycleTransition con auto=true por defecto", async () => {
    await executeAction({ id: "q1", actionType: "SET_LIFECYCLE", entityType: "contact", entityId: "c1",
      config: { toStage: "MQL" } } as never);
    expect(applyMock).toHaveBeenCalledWith(expect.objectContaining({ contactId: "c1", to: "MQL", auto: true }));
  });

  it("rechaza etapa inválida (skip)", async () => {
    const r = await executeAction({ id: "q1", actionType: "SET_LIFECYCLE", entityType: "contact", entityId: "c1",
      config: { toStage: "NOPE" } } as never);
    expect(r.skipped).toBe(true);
    expect(applyMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr, verificar que falla**

Run: `npx vitest run src/lib/workflows/set-lifecycle-action.test.ts`
Expected: FAIL (SET_LIFECYCLE cae al default del switch).

- [ ] **Step 3: Agregar el case en `actions.ts`** — tras el `case "CHANGE_STAGE": { ... }`:

```ts
    case "SET_LIFECYCLE": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      const toStage = String(config.toStage ?? "");
      const STAGES = ["SUSCRIPTOR","LEAD","MQL","SQL","OPORTUNIDAD","CLIENTE","EMBAJADOR"];
      if (!STAGES.includes(toStage)) return { skipped: true, note: `Etapa inválida: ${toStage}` };
      const { applyLifecycleTransition } = await import("@/lib/lifecycle/apply");
      const res = await applyLifecycleTransition({
        contactId: contact.id, from: contact.lifecycleStage, to: toStage as never,
        auto: config.allowBackward === true ? false : true,
        actorUserId: contact.assignedToId ?? null,
      });
      return res.applied ? {} : { skipped: true, note: res.note };
    }
```

- [ ] **Step 4: Actualizar el whitelist de enum `contactType` en `UPDATE_FIELD`** — en la constante `ENUMS.contactType` agregar los valores nuevos (deja los viejos por compat con reglas existentes hasta el paso-2):

```ts
        contactType: ["LEAD","PROSPECTO","CLIENTE","INVERSIONISTA","BROKER_EXTERNO","REFERIDO","EMPLEO","COMPRADOR","REFERIDOR"],
```

- [ ] **Step 5: Correr test, verificar que pasa**

Run: `npx vitest run src/lib/workflows/set-lifecycle-action.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/actions.ts src/lib/workflows/set-lifecycle-action.test.ts
git commit -m "feat(lifecycle): acción SET_LIFECYCLE + contactType nuevos valores en UPDATE_FIELD"
```

---

## Task 7: Builder — trigger LIFECYCLE_CHANGE + condición + sugerencias

**Files:**
- Modify: `src/lib/workflows/builder-model.ts`
- Modify: `src/lib/workflows/builder-model.test.ts`

- [ ] **Step 1: Agregar test al archivo existente** (append en el `describe` de triggers; si no hay, crear bloque)

```ts
import { LIFECYCLE_STAGES } from "./builder-model";
// ...
it("LIFECYCLE_CHANGE escribe toStage", () => {
  expect(buildTriggerConfig("LIFECYCLE_CHANGE", "MQL")).toEqual({ toStage: "MQL" });
});
it("parseTriggerValue lee toStage de LIFECYCLE_CHANGE", () => {
  expect(parseTriggerValue({ triggerType: "LIFECYCLE_CHANGE", triggerConfig: { toStage: "MQL" } })).toBe("MQL");
});
it("contact.lifecycleStage está en FIELD_SUGGESTIONS", () => {
  expect(FIELD_SUGGESTIONS).toContain("contact.lifecycleStage");
});
it("LIFECYCLE_STAGES expone las 7 etapas", () => {
  expect(LIFECYCLE_STAGES).toHaveLength(7);
});
```

(Asegurar que `buildTriggerConfig`, `parseTriggerValue`, `FIELD_SUGGESTIONS` estén importados arriba en el test.)

- [ ] **Step 2: Correr, verificar que falla**

Run: `npx vitest run src/lib/workflows/builder-model.test.ts`
Expected: FAIL.

- [ ] **Step 3: Editar `builder-model.ts`**:
  (a) Agregar `"LIFECYCLE_CHANGE"` al union `TriggerType`.
  (b) En `buildTriggerConfig`, agregar `case "LIFECYCLE_CHANGE": return { toStage: triggerValue };`.
  (c) `parseTriggerValue` ya lee `triggerConfig.toStage` (sirve sin cambio).
  (d) Agregar `"contact.lifecycleStage"` a `FIELD_SUGGESTIONS` (tras `contact.contactType`).
  (e) Exportar la constante de etapas:

```ts
export const LIFECYCLE_STAGES = [
  "SUSCRIPTOR","LEAD","MQL","SQL","OPORTUNIDAD","CLIENTE","EMBAJADOR",
] as const;
```

- [ ] **Step 4: Correr, verificar que pasa**

Run: `npx vitest run src/lib/workflows/builder-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/builder-model.ts src/lib/workflows/builder-model.test.ts
git commit -m "feat(lifecycle): builder soporta LIFECYCLE_CHANGE + contact.lifecycleStage"
```

---

## Task 8: Constantes de UI (labels/colores/orden)

**Files:**
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Agregar bloque de lifecycle** (tras `CONTACT_STATUS_ORDER`)

```ts
// --- Lifecycle del contacto (embudo del comprador/inversionista, tipo HubSpot) ---
export const LIFECYCLE_ORDER = [
  "SUSCRIPTOR","LEAD","MQL","SQL","OPORTUNIDAD","CLIENTE","EMBAJADOR",
] as const;

export const LIFECYCLE_LABELS: Record<string, string> = {
  SUSCRIPTOR: "Suscriptor",
  LEAD: "Lead",
  MQL: "MQL",
  SQL: "Prospecto (SQL)",
  OPORTUNIDAD: "Oportunidad",
  CLIENTE: "Cliente",
  EMBAJADOR: "Embajador",
};

// Espectro funnel frío→cierre (coherente con el rediseño B/N: color solo en etiqueta de etapa).
export const LIFECYCLE_COLORS: Record<string, string> = {
  SUSCRIPTOR: "#94A3B8",
  LEAD: "#3B82F6",
  MQL: "#6366F1",
  SQL: "#8B5CF6",
  OPORTUNIDAD: "#D97706",
  CLIENTE: "#0D9488",
  EMBAJADOR: "#059669",
};
```

- [ ] **Step 2: Actualizar `CONTACT_TYPE_LABELS`** (agregar nuevos, conservar viejos por compat)

```ts
export const CONTACT_TYPE_LABELS: Record<string, string> = {
  LEAD: "Lead",
  PROSPECTO: "Prospecto",
  CLIENTE: "Cliente",
  INVERSIONISTA: "Inversionista",
  BROKER_EXTERNO: "Broker externo",
  REFERIDO: "Referido",
  EMPLEO: "Empleo",
  COMPRADOR: "Comprador",
  REFERIDOR: "Referidor",
} as const;
```

- [ ] **Step 3: Typecheck rápido**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos en `constants.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/constants.ts
git commit -m "feat(lifecycle): labels/colores/orden de lifecycle + CONTACT_TYPE_LABELS"
```

---

## Task 9: API de contactos — lifecycleStage (filtro + override manual)

**Files:**
- Modify: `src/app/api/contacts/route.ts`

- [ ] **Step 1: Leer el schema zod y el PATCH/PUT existentes**

Run: `sed -n '1,60p' src/app/api/contacts/route.ts && echo "---PATCH---" && grep -nE "contactStatus|PATCH|PUT|updateData|function (PATCH|PUT)" src/app/api/contacts/route.ts`
Expected: ubicar el `z.object` de update (línea ~36) y el handler que aplica `updateData`.

- [ ] **Step 2: Agregar `lifecycleStage` al zod de update** (junto a `contactStatus`)

```ts
  lifecycleStage: z.enum(["SUSCRIPTOR","LEAD","MQL","SQL","OPORTUNIDAD","CLIENTE","EMBAJADOR"]).nullable().optional(),
```

- [ ] **Step 3: Manejar el override manual** — en el handler de update, donde se arma `updateData`, en vez de set directo de `lifecycleStage`, enrutar por el helper para que emita evento + Activity:

```ts
    if (data.lifecycleStage !== undefined && data.lifecycleStage !== null) {
      const current = await prisma.contact.findUnique({ where: { id }, select: { lifecycleStage: true } });
      const { applyLifecycleTransition } = await import("@/lib/lifecycle/apply");
      await applyLifecycleTransition({
        contactId: id, from: current?.lifecycleStage ?? null, to: data.lifecycleStage,
        actorUserId: session.user.id, auto: false, // manual: cualquier dirección
      });
      // no agregar lifecycleStage a updateData (ya lo persiste el helper)
    }
```

> Usar el identificador real de la sesión (`session.user.id` o como se acceda en ese archivo). Verificar cómo se obtiene el id del contacto (`id`) y el `session` en el handler.

- [ ] **Step 4: Agregar filtro por `lifecycleStage`** en el GET (junto al filtro `status`/`contactStatus`)

```ts
    const lifecycleStage = searchParams.get("lifecycle") || undefined;
    // ...
    if (lifecycleStage) where.lifecycleStage = lifecycleStage as never;
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/contacts/route.ts
git commit -m "feat(lifecycle): API contactos acepta lifecycleStage (filtro + override manual vía helper)"
```

---

## Task 10: UI — Stepper de lifecycle en el detalle de contacto

**Files:**
- Create: `src/components/contacts/lifecycle-stepper.tsx`
- Modify: `src/components/contacts/contact-detail.tsx`

- [ ] **Step 1: Crear el componente stepper** (composición con oficio; no `<select>`)

```tsx
"use client";
import { LIFECYCLE_ORDER, LIFECYCLE_LABELS, LIFECYCLE_COLORS } from "@/lib/constants";

interface Props {
  value: string | null;
  onChange: (stage: string) => void;
  loading?: boolean;
  readOnly?: boolean;
}

export function LifecycleStepper({ value, onChange, loading, readOnly }: Props) {
  const activeIdx = value ? LIFECYCLE_ORDER.indexOf(value as never) : -1;
  return (
    <div className="flex items-stretch gap-1" role="group" aria-label="Etapa del ciclo de vida">
      {LIFECYCLE_ORDER.map((stage, i) => {
        const done = i <= activeIdx;
        const isActive = i === activeIdx;
        const color = LIFECYCLE_COLORS[stage];
        return (
          <button
            key={stage}
            type="button"
            disabled={readOnly || loading}
            onClick={() => onChange(stage)}
            title={LIFECYCLE_LABELS[stage]}
            className={[
              "relative flex-1 px-2 py-1.5 text-[11px] font-medium tracking-tight",
              "border transition-colors first:rounded-l-md last:rounded-r-md",
              isActive ? "text-white" : done ? "text-neutral-700 dark:text-neutral-200" : "text-neutral-400",
              readOnly ? "cursor-default" : "hover:border-neutral-400",
            ].join(" ")}
            style={isActive ? { background: color, borderColor: color } : { borderColor: done ? color : undefined }}
          >
            {LIFECYCLE_LABELS[stage]}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Integrar en `contact-detail.tsx`** — solo para Comprador/Inversionista; usar el patrón de `changeField` existente (ver `contactStatus` en líneas ~281-288). Tras el bloque de `contactStatus`:

```tsx
{["COMPRADOR","INVERSIONISTA"].includes(contact.contactType) && (
  <div className="space-y-1">
    <label className="text-xs text-neutral-500">Ciclo de vida</label>
    <LifecycleStepper
      value={contact.lifecycleStage ?? null}
      loading={busy === "lifecycleStage"}
      readOnly={acc("lifecycleStage") === "HIDDEN"}
      onChange={(v) => changeField("lifecycleStage", v)}
    />
  </div>
)}
```

Añadir el import: `import { LifecycleStepper } from "./lifecycle-stepper";`

> Verificar que `changeField` hace PATCH a `/api/contacts` (mismo que `contactStatus`); que `contact.lifecycleStage` exista en el tipo del contacto que recibe el componente (si hay una interfaz local, agregar `lifecycleStage: string | null`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add src/components/contacts/lifecycle-stepper.tsx src/components/contacts/contact-detail.tsx
git commit -m "feat(lifecycle): stepper de etapas en el detalle de contacto"
```

---

## Task 11: UI — Badge + filtro de lifecycle en la lista

**Files:**
- Modify: `src/components/contacts/contacts-list.tsx`

- [ ] **Step 1: Leer el patrón de badge/filtro de `contactStatus`**

Run: `grep -nE "contactStatus|CONTACT_STATUS|filtro|status=|setStatus|<select" src/components/contacts/contacts-list.tsx | head -30`
Expected: ubicar (a) la interfaz del row (línea ~61), (b) el badge (líneas ~507-512), (c) el control de filtro.

- [ ] **Step 2: Agregar `lifecycleStage` a la interfaz del row**

```ts
  lifecycleStage: string | null;
```

- [ ] **Step 3: Agregar badge de lifecycle** (junto al de `contactStatus`, solo si no es null)

```tsx
{contact.lifecycleStage && (
  <span className="inline-flex items-center gap-1 text-[11px] font-medium"
        style={{ color: LIFECYCLE_COLORS[contact.lifecycleStage] }}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: LIFECYCLE_COLORS[contact.lifecycleStage] }} />
    {LIFECYCLE_LABELS[contact.lifecycleStage] ?? contact.lifecycleStage}
  </span>
)}
```

Import: `import { LIFECYCLE_LABELS, LIFECYCLE_COLORS, LIFECYCLE_ORDER } from "@/lib/constants";`

- [ ] **Step 4: Agregar control de filtro** (espejo del filtro de status; agrega `&lifecycle=` al fetch)

```tsx
<select value={lifecycleFilter} onChange={(e) => setLifecycleFilter(e.target.value)}
        className="rounded-md border px-2 py-1 text-sm">
  <option value="">Todas las etapas</option>
  {LIFECYCLE_ORDER.map((s) => <option key={s} value={s}>{LIFECYCLE_LABELS[s]}</option>)}
</select>
```

Agregar el state `const [lifecycleFilter, setLifecycleFilter] = useState("");` y, en la construcción de la URL del fetch, `if (lifecycleFilter) params.set("lifecycle", lifecycleFilter);` (seguir el patrón exacto del filtro de status existente).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add src/components/contacts/contacts-list.tsx
git commit -m "feat(lifecycle): badge + filtro de lifecycle en la lista de contactos"
```

---

## Task 12: Default de captura — leads nuevos como COMPRADOR + lifecycle LEAD

**Files:**
- Modify: `prisma/schema.prisma` (default de `Contact.contactType`)
- Modify: `src/lib/intake/capture-lead.ts`

> Razón: tras el paso-1, los leads nuevos deben nacer en la categoría correcta y arrancar el embudo. Los conectores de segmentación (Fase 2) pueden reclasificar a BROKER/EMPLEO después; para esos el lifecycle queda irrelevante (la UI lo oculta y el auto-avance lo ignora).

- [ ] **Step 1: Cambiar el default de `contactType`** en `model Contact`

```prisma
  contactType       ContactType       @default(COMPRADOR)
```

- [ ] **Step 2: `prisma validate` + `generate`**

Run: `npx prisma validate && npx prisma generate`
Expected: válido + cliente regenerado.

- [ ] **Step 3: Leer `capture-lead.ts` alrededor de la creación del contacto**

Run: `sed -n '60,100p' src/lib/intake/capture-lead.ts`
Expected: ver el `prisma.contact.create({ data: { ... contactStatus: "NUEVO" ... } })`.

- [ ] **Step 4: Setear `lifecycleStage: "LEAD"`** en el `data` de creación del contacto nuevo (junto a `contactStatus: "NUEVO"`):

```ts
      contactStatus: "NUEVO",
      lifecycleStage: "LEAD",
```

> Si `capture-lead` actualiza un contacto existente (dedup) en vez de crear, NO sobrescribir su `lifecycleStage` (solo en alta). Verificar la rama create vs update del flujo.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/lib/intake/capture-lead.ts
git commit -m "feat(lifecycle): leads nuevos nacen COMPRADOR + lifecycle LEAD"
```

---

## Task 13: Verificación final (suite completa + build)

- [ ] **Step 1: Correr toda la suite de tests**

Run: `npx vitest run`
Expected: todos verdes (los ~275 previos + los nuevos de lifecycle).

- [ ] **Step 2: Build de producción**

Run: `npm run build`
Expected: exit 0, sin errores de tipos.

- [ ] **Step 3: Confirmar autoría de todos los commits del feature**

Run: `git log --format='%an <%ae>' origin/main..HEAD | sort -u`
Expected: solo `Propyte-Luis <webkoi@webkoi-ai.com>`. Si aparece WebKoi, reescribir con `git rebase`/`filter-branch` (ver feedback_git_author_propyte_crm) antes de cualquier push.

- [ ] **Step 4: Reporte a Luis** — resumen + recordar el gate de migración:
  - "Listo en rama `worktree-crm-lifecycle-stages`, N commits, tests+build verdes."
  - "Falta tu autorización para aplicar la migración: di `aplica la migración lifecycle` y la corro vía MCP (2 envíos: ADD VALUE, luego backfill)."
  - "Tras aplicar: merge ff a main → auto-deploy Hostinger."

---

## Notas de ejecución

- **Gate de migración (CRÍTICO):** la BD `oaijxdpevakashxshhvm` es compartida con prod. El código de Tasks 1–11 funciona en local con `prisma generate` (tipos), pero las **queries que lean/escriban `lifecycleStage` fallarán en runtime hasta aplicar el SQL**. Por eso los tests mockean prisma. NO aplicar sin la frase de Luis.
- **Orden de dependencias:** Task 1 (tipos) antes que todo. Tasks 3→4→5→6 en orden (apply depende de transitions; engine/actions dependen de apply). Tasks 8 antes de 10/11 (constantes). 9/10/11 (UI/API) independientes entre sí tras 8.
- **Lección Fase 2 aplicada:** el valor de enum va en (a) Prisma, (b) whitelist runtime de `actions.ts`, (c) zod de la API, (d) constantes de UI. Cubierto en Tasks 1, 6, 9, 8 respectivamente.
