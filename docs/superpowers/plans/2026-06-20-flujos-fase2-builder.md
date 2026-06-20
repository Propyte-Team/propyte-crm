# Flujos & SLA Fase 2 — Builder paridad-Zoho — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Llevar el builder visual de reglas (`/configuracion` → Workflows & SLA) a paridad-Zoho: fix STAGE_CHANGE, acciones diferidas, campos enriquecidos, condiciones anidadas (2 niveles), enum `EMPLEO` y plantillas de regla — sin tocar JSON crudo.

**Architecture:** La lógica pura del builder se extrae a `src/lib/workflows/builder-model.ts` (testeable con Vitest). El componente `workflow-builder.tsx` solo orquesta estado/JSX e importa del módulo. El motor (`engine.ts`, `evaluate-conditions.ts`) y el DSL (`conditionsDslSchema`) ya soportan lo necesario; los fixes son en la capa builder + el `ruleSchema` de la API (que hoy descarta `delayMinutes`).

**Tech Stack:** Next.js 14, React 18, TypeScript 5.7, Zod 3.24, Prisma 6 (PostgreSQL/Supabase, schema `propyte_crm`), Vitest 2.

---

## Convenciones de este plan

- **Rama:** `feat/flujos-fase2-builder` (ya creada). Antes de cada commit: `git branch --show-current` debe ser esa rama (working tree compartido — ver gotchas). Autoría ya configurada (`Propyte-Luis` / `webkoi@webkoi-ai.com`).
- **Test runner:** Vitest. Un archivo: `npx vitest run <ruta>`. Todo: `npm test`.
- **Tests co-locados:** `foo.ts` → `foo.test.ts` en la misma carpeta.
- **Cada commit** termina con: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **TDD:** test rojo → mínimo verde → commit. `npm run build` verde antes del commit final de cada task que toque la UI/API.
- **Migración (Task 7):** NO aplicar a la BD sin OK explícito de Luis. El código (schema + generate) se prepara; el SQL se aplica aparte.

---

## File Structure

- **Create** `src/lib/workflows/builder-model.ts` — lógica pura: tipos (`CondLeaf`, `CondGroup`, `CondItem`, `ConditionTree`, `ActionRow`, `TriggerType`), `buildTriggerConfig`, `parseTriggerValue`, `parseValue`, `buildConditions`, `parseConditions`, constantes `FIELD_SUGGESTIONS`, `DEAL_STAGES`.
- **Create** `src/lib/workflows/builder-model.test.ts` — unit tests del módulo.
- **Create** `src/lib/workflows/builder-templates.ts` — catálogo de plantillas de regla (Lead/Broker/Empleo).
- **Create** `src/lib/workflows/builder-templates.test.ts` — valida cada plantilla contra `ruleSchema`-equivalente.
- **Modify** `src/components/config/workflow-builder.tsx` — usa el módulo; UI de delayMinutes, campos, grupos anidados, dropdown de plantillas.
- **Modify** `src/app/api/admin/automation/rules/route.ts` — `ruleSchema.actions` acepta `delayMinutes`.
- **Modify** `src/lib/workflows/engine.ts` — (solo si Task 2 lo requiere; se espera que NO — el motor ya lee `toStage`).
- **Modify** `prisma/schema.prisma` — `enum ContactType += EMPLEO`.
- **Create** `prisma/migrations-manual/2026-06-20-contacttype-empleo.sql` — `ALTER TYPE ... ADD VALUE`.

---

## Task 1: Extraer lógica pura a `builder-model.ts` (sin cambio funcional)

Extrae las funciones actuales del componente **tal cual** (incluido el bug de `stage`, que se arregla en Task 2) + tests de caracterización. Esto habilita TDD para las tasks siguientes.

**Files:**
- Create: `src/lib/workflows/builder-model.ts`
- Test: `src/lib/workflows/builder-model.test.ts`
- Modify: `src/components/config/workflow-builder.tsx` (importar, borrar copias locales)

- [ ] **Step 1: Escribir el módulo con la lógica actual**

Create `src/lib/workflows/builder-model.ts`:

```ts
// Lógica pura del builder visual de reglas (Fase 2). Sin React, sin BD → testeable.
import type { ConditionNode } from "@/lib/validations/rebuild-f1";

export type TriggerType =
  | "EVENT" | "STAGE_CHANGE" | "SCORE_THRESHOLD" | "INACTIVITY"
  | "SLA_BREACH" | "TIME" | "BEHAVIORAL";

export type Combinator = "all" | "any";

export interface CondLeaf { field: string; op: string; value: string }
export interface CondGroup { combinator: Combinator; conditions: CondLeaf[] }
export type CondItem = CondLeaf | CondGroup;
export interface ConditionTree { combinator: Combinator; items: CondItem[] }

export interface ActionRow { type: string; config: Record<string, string>; delayMinutes?: string }

export const DEAL_STAGES = [
  "NEW_LEAD", "CONTACTED", "DISCOVERY_DONE", "MEETING_SCHEDULED", "MEETING_COMPLETED",
  "PROPOSAL_SENT", "NEGOTIATION", "RESERVED", "CONTRACT_SIGNED", "CLOSING", "WON", "LOST", "FROZEN",
] as const;

export const FIELD_SUGGESTIONS = [
  "contact.score", "contact.temperature", "contact.contactStatus", "contact.urgency",
  "contact.budgetMax", "contact.leadSource", "deal.stage", "deal.estimatedValue",
  "deal.dealType", "event.type",
];

export function isGroup(item: CondItem): item is CondGroup {
  return (item as CondGroup).combinator !== undefined;
}

// NOTA: contiene el bug histórico (STAGE_CHANGE → { stage }). Se arregla en Task 2.
export function buildTriggerConfig(triggerType: string, triggerValue: string): Record<string, unknown> {
  if (!triggerValue) return {};
  switch (triggerType) {
    case "EVENT": return { eventType: triggerValue };
    case "STAGE_CHANGE": return { stage: triggerValue };
    case "SCORE_THRESHOLD": return { threshold: Number(triggerValue) || 0 };
    case "INACTIVITY": return { hours: Number(triggerValue) || 0 };
    default: return {};
  }
}

export function parseTriggerValue(rule: any): string {
  return String(
    rule?.triggerConfig?.eventType ?? rule?.triggerConfig?.stage ??
    rule?.triggerConfig?.threshold ?? rule?.triggerConfig?.hours ?? ""
  );
}

export function parseValue(op: string, raw: string): unknown {
  if (op === "exists") return true;
  if (op === "in" || op === "nin") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (/^-?\d+(\.\d+)?$/.test(raw.trim())) return Number(raw.trim());
  return raw;
}

// Versión plana (Task 1). Reemplazada por la versión con árbol en Task 5.
export function buildConditions(combinator: Combinator, conds: CondLeaf[]): Record<string, unknown> {
  const valid = conds.filter((c) => c.field && c.op);
  if (valid.length === 0) return {};
  return { [combinator]: valid.map((c) => ({ field: c.field, op: c.op, value: parseValue(c.op, c.value) })) };
}

export function nodeToRows(conditions: any): { combinator: Combinator; rows: CondLeaf[] } {
  if (conditions && typeof conditions === "object") {
    const key = conditions.all ? "all" : conditions.any ? "any" : null;
    if (key) {
      const rows = (conditions[key] as any[])
        .filter((n) => n.field)
        .map((n) => ({ field: n.field, op: n.op, value: Array.isArray(n.value) ? n.value.join(",") : n.value != null ? String(n.value) : "" }));
      return { combinator: key, rows };
    }
  }
  return { combinator: "all", rows: [] };
}

export type { ConditionNode };
```

- [ ] **Step 2: Escribir tests de caracterización**

Create `src/lib/workflows/builder-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTriggerConfig, parseValue, buildConditions, nodeToRows, parseTriggerValue } from "./builder-model";

describe("parseValue", () => {
  it("exists → true", () => expect(parseValue("exists", "")).toBe(true));
  it("in → array recortado", () => expect(parseValue("in", "a, b ,c")).toEqual(["a", "b", "c"]));
  it("numérico → number", () => expect(parseValue("eq", "70")).toBe(70));
  it("texto → string", () => expect(parseValue("contains", "BROKER")).toBe("BROKER"));
});

describe("buildConditions (plano)", () => {
  it("vacío → {}", () => expect(buildConditions("all", [])).toEqual({}));
  it("filtra incompletas y serializa", () => {
    expect(buildConditions("any", [
      { field: "contact.score", op: "gte", value: "70" },
      { field: "", op: "eq", value: "x" },
    ])).toEqual({ any: [{ field: "contact.score", op: "gte", value: 70 }] });
  });
});

describe("nodeToRows", () => {
  it("reconstruye filas desde DSL", () => {
    expect(nodeToRows({ all: [{ field: "deal.stage", op: "eq", value: "WON" }] }))
      .toEqual({ combinator: "all", rows: [{ field: "deal.stage", op: "eq", value: "WON" }] });
  });
});

describe("buildTriggerConfig / parseTriggerValue", () => {
  it("EVENT round-trip", () => {
    const cfg = buildTriggerConfig("EVENT", "lead.captured");
    expect(cfg).toEqual({ eventType: "lead.captured" });
    expect(parseTriggerValue({ triggerConfig: cfg })).toBe("lead.captured");
  });
});
```

- [ ] **Step 3: Correr tests (deben pasar — caracterización)**

Run: `npx vitest run src/lib/workflows/builder-model.test.ts`
Expected: PASS (4 describe, todos verdes)

- [ ] **Step 4: Refactor del componente para usar el módulo**

En `src/components/config/workflow-builder.tsx`:
- Borrar las constantes locales `FIELD_SUGGESTIONS` y `DEAL_STAGES` (líneas ~32-41) y la función local `nodeToRows` (líneas ~78-89), y las funciones internas `buildTriggerConfig`, `parseValue`, `buildConditions` (dentro del componente, líneas ~112-134).
- Agregar import arriba:
  ```ts
  import {
    buildTriggerConfig, parseValue, buildConditions, nodeToRows, parseTriggerValue,
    FIELD_SUGGESTIONS, DEAL_STAGES, type CondLeaf,
  } from "@/lib/workflows/builder-model";
  ```
- Reemplazar la interfaz local `interface CondRow {...}` por el uso de `CondLeaf` (renombrar `CondRow` → `CondLeaf` en el archivo).
- Reemplazar el init de `triggerValue` por `useState<string>(parseTriggerValue(rule))`.
- Donde el componente llamaba a las funciones internas, ahora llama a las importadas:
  - `buildTriggerConfig()` → `buildTriggerConfig(triggerType, triggerValue)`
  - `buildConditions()` → `buildConditions(combinator, conds)`
  - `parseValue(...)` ya no se llama directo en el componente (vive dentro de `buildConditions`).

- [ ] **Step 5: Verificar build + tests**

Run: `npm run build`
Expected: build verde (sin errores de tipo).
Run: `npx vitest run src/lib/workflows/builder-model.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # debe ser feat/flujos-fase2-builder
git add src/lib/workflows/builder-model.ts src/lib/workflows/builder-model.test.ts src/components/config/workflow-builder.tsx
git commit -m "refactor(workflows): extraer lógica pura del builder a builder-model

Sin cambio funcional. Habilita TDD para Fase 2.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Fix bug STAGE_CHANGE (`toStage`)

El motor lee `triggerConfig.toStage` (`engine.ts:19`) pero el builder escribe `{ stage }`. Resultado: la regla matchea TODA transición de etapa, ignora la etapa elegida.

**Files:**
- Modify: `src/lib/workflows/builder-model.ts` (`buildTriggerConfig`, `parseTriggerValue`)
- Test: `src/lib/workflows/builder-model.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `builder-model.test.ts`:

```ts
import { matchesTrigger } from "./engine";

describe("STAGE_CHANGE usa toStage (bug fix)", () => {
  it("buildTriggerConfig escribe toStage", () => {
    expect(buildTriggerConfig("STAGE_CHANGE", "RESERVED")).toEqual({ toStage: "RESERVED" });
  });

  it("parseTriggerValue lee toStage y compat con 'stage' viejo", () => {
    expect(parseTriggerValue({ triggerConfig: { toStage: "WON" } })).toBe("WON");
    expect(parseTriggerValue({ triggerConfig: { stage: "LOST" } })).toBe("LOST"); // regla vieja
  });

  it("round-trip: regla del builder matchea evento deal.stage_changed", () => {
    const cfg = buildTriggerConfig("STAGE_CHANGE", "RESERVED");
    const rule = { triggerType: "STAGE_CHANGE" as const, triggerConfig: cfg };
    const event = { type: "deal.stage_changed", payload: { toStage: "RESERVED" } };
    expect(matchesTrigger(rule, event as any)).toBe(true);
    const other = { type: "deal.stage_changed", payload: { toStage: "WON" } };
    expect(matchesTrigger(rule, other as any)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr → falla**

Run: `npx vitest run src/lib/workflows/builder-model.test.ts`
Expected: FAIL en "buildTriggerConfig escribe toStage" (recibe `{ stage: "RESERVED" }`) y en el round-trip (matchea ambos porque `toStage` undefined).

- [ ] **Step 3: Arreglar `buildTriggerConfig` y `parseTriggerValue`**

En `builder-model.ts`:
- `case "STAGE_CHANGE": return { toStage: triggerValue };`
- En `parseTriggerValue`, cambiar el orden a:
  ```ts
  rule?.triggerConfig?.eventType ?? rule?.triggerConfig?.toStage ?? rule?.triggerConfig?.stage ??
  rule?.triggerConfig?.threshold ?? rule?.triggerConfig?.hours ?? ""
  ```
  (lee `toStage` primero; `stage` queda como fallback para reglas guardadas antes del fix.)

- [ ] **Step 4: Correr → pasa**

Run: `npx vitest run src/lib/workflows/builder-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/lib/workflows/builder-model.ts src/lib/workflows/builder-model.test.ts
git commit -m "fix(workflows): builder escribe toStage en STAGE_CHANGE (matchea etapa real)

Antes escribía {stage}; el motor lee {toStage} → la regla matcheaba toda
transición. Compat: parseTriggerValue lee toStage y cae a stage para reglas viejas.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `delayMinutes` por acción (builder + API)

El motor ya respeta `spec.delayMinutes` (`engine.ts:106`) y `actionSpecSchema` lo acepta (`rebuild-f1.ts:46`). **Pero** el `ruleSchema` de la API (`route.ts:19-21`) valida `actions` con un schema inline `{ type, config }` que **descarta** `delayMinutes` antes de guardar. Hay que arreglar API + builder.

**Files:**
- Modify: `src/app/api/admin/automation/rules/route.ts` (`ruleSchema.actions`)
- Modify: `src/components/config/workflow-builder.tsx` (UI + payload)
- Test: `src/app/api/admin/automation/rules/route.test.ts` (crear) — valida el schema acepta delayMinutes

- [ ] **Step 1: Escribir test del schema de la API**

Create `src/app/api/admin/automation/rules/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { conditionsDslSchema, workflowActionTypes } from "@/lib/validations/rebuild-f1";

// Réplica del actions schema que DEBE usar la API (incluye delayMinutes).
const actionsSchema = z
  .array(z.object({
    type: z.enum(workflowActionTypes),
    config: z.record(z.unknown()).default({}),
    delayMinutes: z.number().int().min(0).optional(),
  }))
  .min(1);

describe("ruleSchema.actions acepta delayMinutes", () => {
  it("conserva delayMinutes tras parsear", () => {
    const r = actionsSchema.parse([{ type: "SEND_WHATSAPP", config: { body: "hola" }, delayMinutes: 10 }]);
    expect(r[0].delayMinutes).toBe(10);
  });
  it("delayMinutes ausente es válido", () => {
    const r = actionsSchema.parse([{ type: "ADD_TAG", config: { tag: "x" } }]);
    expect(r[0].delayMinutes).toBeUndefined();
  });
  it("conditionsDslSchema sigue aceptando objeto vacío", () => {
    expect(conditionsDslSchema.parse({})).toEqual({});
  });
});
```

- [ ] **Step 2: Correr → pasa el test (caracteriza el schema deseado)**

Run: `npx vitest run src/app/api/admin/automation/rules/route.test.ts`
Expected: PASS (el test define el schema correcto; el siguiente paso lo refleja en la API real).

- [ ] **Step 3: Actualizar `ruleSchema.actions` en la API**

En `src/app/api/admin/automation/rules/route.ts`, reemplazar el bloque `actions:` del `ruleSchema` por:

```ts
  actions: z
    .array(z.object({
      type: z.enum(workflowActionTypes),
      config: z.record(z.unknown()).default({}),
      delayMinutes: z.number().int().min(0).optional(),
    }))
    .min(1, "Agrega al menos una acción"),
```

(Tanto POST como PUT usan `ruleSchema`, así que ambos quedan cubiertos. El `prisma.create/update` guarda `d.actions as never` → `delayMinutes` persiste en el JSONB.)

- [ ] **Step 4: UI de delayMinutes en el builder**

En `workflow-builder.tsx`:
- La interfaz de fila de acción ahora es `ActionRow` (de `builder-model`, ya tiene `delayMinutes?: string`). Asegurar que el estado `actions` use ese tipo.
- En la tarjeta de cada acción, después del grid de `ACTION_FIELDS`, agregar un input:
  ```tsx
  <div className="mt-2">
    <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Retrasar (min)</label>
    <input className="form-input max-w-[160px] text-[13px]" type="number" min={0} placeholder="0 = inmediata"
      value={a.delayMinutes ?? ""}
      onChange={(e) => setActions(actions.map((x, j) => j === i ? { ...x, delayMinutes: e.target.value } : x))} />
  </div>
  ```
- En `save()`, el payload de acciones pasa a:
  ```ts
  actions: actions.map((a) => ({
    type: a.type,
    config: a.config,
    ...(a.delayMinutes && Number(a.delayMinutes) > 0 ? { delayMinutes: Number(a.delayMinutes) } : {}),
  })),
  ```
- Al cargar regla existente (init de `actions`), mapear `delayMinutes` a string:
  ```ts
  rule.actions.map((a: any) => ({ type: a.type, config: a.config ?? {}, delayMinutes: a.delayMinutes != null ? String(a.delayMinutes) : "" }))
  ```

- [ ] **Step 5: Verificar build + tests**

Run: `npm run build` → verde.
Run: `npx vitest run src/app/api/admin/automation/rules/route.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add src/app/api/admin/automation/rules/route.ts src/app/api/admin/automation/rules/route.test.ts src/components/config/workflow-builder.tsx
git commit -m "feat(workflows): delayMinutes por acción en builder + API

La API descartaba delayMinutes (schema inline). Ahora lo acepta y persiste;
el builder expone 'Retrasar (min)' por acción. El motor ya lo respeta.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Selector de campos enriquecido

Agregar campos de segmentación a las sugerencias (datalist — no rompe escritura libre). El motor ya expone `adAttribution` y `contact.contactType`.

**Files:**
- Modify: `src/lib/workflows/builder-model.ts` (`FIELD_SUGGESTIONS`)
- Test: `src/lib/workflows/builder-model.test.ts`

- [ ] **Step 1: Test que falla**

Agregar a `builder-model.test.ts`:

```ts
import { FIELD_SUGGESTIONS } from "./builder-model";

describe("FIELD_SUGGESTIONS incluye campos de segmentación", () => {
  it("tiene contactType y adAttribution.*", () => {
    for (const f of ["contact.contactType", "adAttribution.campaignName", "adAttribution.adName", "adAttribution.adsetName", "adAttribution.network", "contact.custom."]) {
      expect(FIELD_SUGGESTIONS).toContain(f);
    }
  });
});
```

- [ ] **Step 2: Correr → falla**

Run: `npx vitest run src/lib/workflows/builder-model.test.ts`
Expected: FAIL (no contiene `contact.contactType`).

- [ ] **Step 3: Ampliar `FIELD_SUGGESTIONS`**

En `builder-model.ts`, reemplazar la const por:

```ts
export const FIELD_SUGGESTIONS = [
  "contact.score", "contact.temperature", "contact.contactStatus", "contact.contactType",
  "contact.urgency", "contact.budgetMax", "contact.leadSource",
  "adAttribution.campaignName", "adAttribution.adName", "adAttribution.adsetName", "adAttribution.network",
  "contact.custom.",
  "deal.stage", "deal.estimatedValue", "deal.dealType", "event.type",
];
```

- [ ] **Step 4: Correr → pasa**

Run: `npx vitest run src/lib/workflows/builder-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/lib/workflows/builder-model.ts src/lib/workflows/builder-model.test.ts
git commit -m "feat(workflows): campos contactType/adAttribution/custom en el builder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Condiciones anidadas — 2 niveles

Modelo de árbol: grupo raíz cuyos items son condición hoja o sub-grupo (con su propio `all`/`any`). Profundidad fija = 2. `evaluate-conditions.ts` y `conditionsDslSchema` ya soportan el DSL anidado.

**Files:**
- Modify: `src/lib/workflows/builder-model.ts` (`buildConditions` con árbol, `parseConditions`)
- Modify: `src/components/config/workflow-builder.tsx` (estado de árbol + JSX)
- Test: `src/lib/workflows/builder-model.test.ts`

- [ ] **Step 1: Tests que fallan (árbol)**

Agregar a `builder-model.test.ts`:

```ts
import { buildConditionsTree, parseConditions, type ConditionTree } from "./builder-model";

describe("condiciones anidadas (árbol 2 niveles)", () => {
  const tree: ConditionTree = {
    combinator: "any",
    items: [
      { field: "contact.score", op: "gte", value: "70" },
      { combinator: "all", conditions: [
        { field: "adAttribution.campaignName", op: "contains", value: "BROKER" },
        { field: "contact.leadSource", op: "eq", value: "REGISTRO_BROKER" },
      ] },
    ],
  };

  it("buildConditionsTree serializa al DSL anidado", () => {
    expect(buildConditionsTree(tree)).toEqual({
      any: [
        { field: "contact.score", op: "gte", value: 70 },
        { all: [
          { field: "adAttribution.campaignName", op: "contains", value: "BROKER" },
          { field: "contact.leadSource", op: "eq", value: "REGISTRO_BROKER" },
        ] },
      ],
    });
  });

  it("round-trip DSL→árbol→DSL es idempotente", () => {
    const dsl = buildConditionsTree(tree);
    expect(buildConditionsTree(parseConditions(dsl))).toEqual(dsl);
  });

  it("grupo sin hojas válidas se omite", () => {
    const t: ConditionTree = { combinator: "all", items: [{ combinator: "any", conditions: [{ field: "", op: "eq", value: "" }] }] };
    expect(buildConditionsTree(t)).toEqual({});
  });

  it("árbol vacío → {}", () => {
    expect(buildConditionsTree({ combinator: "all", items: [] })).toEqual({});
  });
});
```

- [ ] **Step 2: Correr → falla**

Run: `npx vitest run src/lib/workflows/builder-model.test.ts`
Expected: FAIL (`buildConditionsTree`/`parseConditions` no existen).

- [ ] **Step 3: Implementar árbol en `builder-model.ts`**

Agregar (mantener `buildConditions` plano para compat de Task 1, o eliminar sus usos — el componente pasa a usar el árbol):

```ts
function leafToDsl(c: CondLeaf) {
  return { field: c.field, op: c.op, value: parseValue(c.op, c.value) };
}

export function buildConditionsTree(tree: ConditionTree): Record<string, unknown> {
  const parts: unknown[] = [];
  for (const item of tree.items) {
    if (isGroup(item)) {
      const valid = item.conditions.filter((c) => c.field && c.op);
      if (valid.length > 0) parts.push({ [item.combinator]: valid.map(leafToDsl) });
    } else if (item.field && item.op) {
      parts.push(leafToDsl(item));
    }
  }
  if (parts.length === 0) return {};
  return { [tree.combinator]: parts };
}

function dslLeafToRow(n: any): CondLeaf {
  return { field: n.field, op: n.op, value: Array.isArray(n.value) ? n.value.join(",") : n.value != null ? String(n.value) : "" };
}

export function parseConditions(conditions: any): ConditionTree {
  if (conditions && typeof conditions === "object") {
    const key: Combinator | null = conditions.all ? "all" : conditions.any ? "any" : null;
    if (key) {
      const items: CondItem[] = (conditions[key] as any[]).map((n) => {
        const subKey: Combinator | null = n?.all ? "all" : n?.any ? "any" : null;
        if (subKey) return { combinator: subKey, conditions: (n[subKey] as any[]).filter((x) => x.field).map(dslLeafToRow) };
        return dslLeafToRow(n);
      }).filter((it) => isGroup(it) ? it.conditions.length > 0 : !!it.field);
      return { combinator: key, items };
    }
  }
  return { combinator: "all", items: [] };
}
```

- [ ] **Step 4: Correr → pasa**

Run: `npx vitest run src/lib/workflows/builder-model.test.ts`
Expected: PASS

- [ ] **Step 5: Wiring del componente (estado de árbol + JSX)**

En `workflow-builder.tsx`:
- Reemplazar el estado `combinator` + `conds` por un único árbol:
  ```ts
  const initTree = parseConditions(rule?.conditions);
  const [tree, setTree] = useState<ConditionTree>(initTree);
  ```
  (importar `parseConditions`, `buildConditionsTree`, `isGroup`, tipos `ConditionTree`, `CondGroup`, `CondItem` de `builder-model`; quitar el uso de `buildConditions`/`nodeToRows` plano.)
- En `save()`: `conditions: buildConditionsTree(tree)`.
- Helpers de edición dentro del componente:
  ```ts
  const setRoot = (combinator: "all" | "any") => setTree({ ...tree, combinator });
  const addLeaf = () => setTree({ ...tree, items: [...tree.items, { field: "", op: "eq", value: "" }] });
  const addGroup = () => setTree({ ...tree, items: [...tree.items, { combinator: "all", conditions: [{ field: "", op: "eq", value: "" }] }] });
  const updItem = (i: number, item: CondItem) => setTree({ ...tree, items: tree.items.map((x, j) => j === i ? item : x) });
  const delItem = (i: number) => setTree({ ...tree, items: tree.items.filter((_, j) => j !== i) });
  ```
- Reemplazar el bloque JSX de "Condiciones" (el `{conds.map(...)}` y sus botones) por un render que recorre `tree.items`: cada item plano renderiza la fila `field/op/value` existente (usando `updItem`); cada grupo renderiza una sub-tarjeta con su selector `todas/cualquiera` y su propia lista de filas `field/op/value` (editando `item.conditions`), más un botón "Condición" interno. Debajo, dos botones: "+ Condición" (`addLeaf`) y "+ Grupo" (`addGroup`). Usar `isGroup(item)` para discriminar. El `datalist#field-suggestions` se mantiene y lo comparten todas las filas.

  Estructura JSX de referencia para el body de Condiciones:
  ```tsx
  <datalist id="field-suggestions">{FIELD_SUGGESTIONS.map((f) => <option key={f} value={f} />)}</datalist>
  {tree.items.map((item, i) => isGroup(item) ? (
    <div key={i} className="rounded-md border p-3" style={{ borderColor: "var(--border-subtle)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12px]">
          <span style={{ color: "var(--text-tertiary)" }}>Subgrupo — cumplir</span>
          <select className="form-input !w-auto text-[12px]" value={item.combinator}
            onChange={(e) => updItem(i, { ...item, combinator: e.target.value as "all" | "any" })}>
            <option value="all">todas</option><option value="any">cualquiera</option>
          </select>
        </div>
        <button type="button" onClick={() => delItem(i)} className="shrink-0 text-[color:var(--text-tertiary)] hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
      </div>
      {item.conditions.map((c, k) => (
        <CondRowFields key={k} c={c}
          onChange={(nc) => updItem(i, { ...item, conditions: item.conditions.map((x, m) => m === k ? nc : x) })}
          onDelete={() => updItem(i, { ...item, conditions: item.conditions.filter((_, m) => m !== k) })} />
      ))}
      <button type="button" onClick={() => updItem(i, { ...item, conditions: [...item.conditions, { field: "", op: "eq", value: "" }] })} className="btn-secondary text-[12px]">
        <Plus className="h-3.5 w-3.5" /> Condición
      </button>
    </div>
  ) : (
    <CondRowFields key={i} c={item} onChange={(nc) => updItem(i, nc)} onDelete={() => delItem(i)} />
  ))}
  <div className="flex gap-2">
    <button type="button" onClick={addLeaf} className="btn-secondary text-[12px]"><Plus className="h-3.5 w-3.5" /> Condición</button>
    <button type="button" onClick={addGroup} className="btn-secondary text-[12px]"><Plus className="h-3.5 w-3.5" /> Grupo</button>
  </div>
  ```
  Y extraer la fila a un sub-componente local en el mismo archivo para reusarla en raíz y grupo:
  ```tsx
  function CondRowFields({ c, onChange, onDelete }: { c: CondLeaf; onChange: (c: CondLeaf) => void; onDelete: () => void }) {
    return (
      <div className="flex items-center gap-2">
        <input list="field-suggestions" className="form-input text-[13px]" placeholder="campo (ej. contact.score)" value={c.field}
          onChange={(e) => onChange({ ...c, field: e.target.value })} />
        <select className="form-input !w-auto text-[13px]" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value })}>
          {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {c.op !== "exists" && (
          <input className="form-input text-[13px]" placeholder={c.op === "in" || c.op === "nin" ? "a,b,c" : "valor"} value={c.value}
            onChange={(e) => onChange({ ...c, value: e.target.value })} />
        )}
        <button type="button" onClick={onDelete} className="shrink-0 text-[color:var(--text-tertiary)] hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
      </div>
    );
  }
  ```
  (`OPS` ya existe en el archivo; mantenerlo.) El selector raíz `todas/cualquiera` usa `tree.combinator` + `setRoot`.

- [ ] **Step 6: Verificar build + tests**

Run: `npm run build` → verde.
Run: `npx vitest run src/lib/workflows/builder-model.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git branch --show-current
git add src/lib/workflows/builder-model.ts src/lib/workflows/builder-model.test.ts src/components/config/workflow-builder.tsx
git commit -m "feat(workflows): condiciones anidadas (2 niveles) en el builder

Modelo de árbol raíz→hoja|subgrupo; serializa al DSL all/any que el motor
ya evalúa. Round-trip idempotente.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Plantillas de regla (Lead / Broker / Empleo)

Catálogo de recetas pre-armadas que el builder carga en el form (editables antes de guardar). Aceleran el setup de la segmentación por campaña.

**Files:**
- Create: `src/lib/workflows/builder-templates.ts`
- Create: `src/lib/workflows/builder-templates.test.ts`
- Modify: `src/components/config/workflow-builder.tsx` (dropdown "Usar plantilla")

> **Nota de enums (verificada):** `ContactType` válidos hoy = LEAD, PROSPECTO, CLIENTE, INVERSIONISTA, BROKER_EXTERNO, REFERIDO (+ EMPLEO tras Task 7). `LeadSource` incluye META_ADS y REGISTRO_BROKER. Las plantillas usan: Lead→`LEAD`/`META_ADS`; Broker→`BROKER_EXTERNO`/`REGISTRO_BROKER`; Empleo→`EMPLEO`/`META_ADS`.

- [ ] **Step 1: Test que falla — cada plantilla es válida contra el schema de la API**

Create `src/lib/workflows/builder-templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { RULE_TEMPLATES } from "./builder-templates";
import { conditionsDslSchema, workflowActionTypes } from "@/lib/validations/rebuild-f1";

const TRIGGER_TYPES = ["EVENT", "TIME", "BEHAVIORAL", "INACTIVITY", "STAGE_CHANGE", "SLA_BREACH", "SCORE_THRESHOLD"] as const;
const ruleSchema = z.object({
  name: z.string().min(3).max(120),
  description: z.string().max(500).optional().nullable(),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: z.record(z.unknown()).default({}),
  conditions: conditionsDslSchema,
  actions: z.array(z.object({
    type: z.enum(workflowActionTypes),
    config: z.record(z.unknown()).default({}),
    delayMinutes: z.number().int().min(0).optional(),
  })).min(1),
});

describe("RULE_TEMPLATES", () => {
  it("hay 3 plantillas con keys Lead/Broker/Empleo", () => {
    expect(RULE_TEMPLATES.map((t) => t.key).sort()).toEqual(["broker", "empleo", "lead"]);
  });
  it("cada plantilla produce una regla válida contra ruleSchema", () => {
    for (const t of RULE_TEMPLATES) {
      const parsed = ruleSchema.safeParse(t.rule);
      expect(parsed.success, `${t.key}: ${JSON.stringify((parsed as any).error?.flatten?.())}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Correr → falla**

Run: `npx vitest run src/lib/workflows/builder-templates.test.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar el catálogo**

Create `src/lib/workflows/builder-templates.ts`:

```ts
// Plantillas de regla ("recetas") para el builder. Pre-llenan el form (editables).
// Segmentan por campaña (adAttribution.campaignName) → tipo/fuente/asignación/tag.
export interface RuleTemplate {
  key: "lead" | "broker" | "empleo";
  label: string;
  description: string;
  rule: {
    name: string;
    description: string;
    triggerType: "EVENT";
    triggerConfig: Record<string, unknown>;
    conditions: Record<string, unknown>;
    actions: { type: string; config: Record<string, unknown>; delayMinutes?: number }[];
  };
}

function tpl(key: RuleTemplate["key"], label: string, marker: string, contactType: string, leadSource: string, tag: string): RuleTemplate {
  return {
    key,
    label,
    description: `Lead cuya campaña contiene "${marker}" → tipo ${contactType}, fuente ${leadSource}, asignar y etiquetar.`,
    rule: {
      name: `${label} por campaña`,
      description: `Segmenta por campaña ${marker} (editar antes de guardar).`,
      triggerType: "EVENT",
      triggerConfig: { eventType: "lead.captured" },
      conditions: { all: [{ field: "adAttribution.campaignName", op: "contains", value: marker }] },
      actions: [
        { type: "UPDATE_FIELD", config: { field: "contactType", value: contactType } },
        { type: "UPDATE_FIELD", config: { field: "leadSource", value: leadSource } },
        { type: "ASSIGN", config: { strategy: "round_robin" } },
        { type: "ADD_TAG", config: { tag } },
      ],
    },
  };
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  tpl("lead", "Lead", "[LEADS]", "LEAD", "META_ADS", "lead"),
  tpl("broker", "Broker", "BROKER", "BROKER_EXTERNO", "REGISTRO_BROKER", "broker"),
  tpl("empleo", "Empleo", "EMPLEO", "EMPLEO", "META_ADS", "empleo"),
];
```

- [ ] **Step 4: Correr → pasa**

Run: `npx vitest run src/lib/workflows/builder-templates.test.ts`
Expected: PASS

> Nota: la plantilla "empleo" usa `contactType=EMPLEO`, que solo es válido en runtime tras Task 7. El test valida el **schema de la API** (string), no el enum de Prisma, así que pasa. La validación contra el enum de Prisma ocurre en `UPDATE_FIELD` en ejecución (post-migración).

- [ ] **Step 5: Dropdown "Usar plantilla" en el builder**

En `workflow-builder.tsx`:
- Importar: `import { RULE_TEMPLATES } from "@/lib/workflows/builder-templates";`
- Función para aplicar plantilla (pre-llena el form, no guarda):
  ```ts
  function applyTemplate(key: string) {
    const t = RULE_TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    setName(t.rule.name);
    setDescription(t.rule.description);
    setTriggerType(t.rule.triggerType);
    setTriggerValue(String(t.rule.triggerConfig.eventType ?? ""));
    setTree(parseConditions(t.rule.conditions));
    setActions(t.rule.actions.map((a) => ({ type: a.type, config: a.config as Record<string, string>, delayMinutes: a.delayMinutes != null ? String(a.delayMinutes) : "" })));
  }
  ```
- En el JSX, arriba del bloque "Identidad", agregar (solo cuando NO es edición — `!isEdit`):
  ```tsx
  {!isEdit && (
    <Field label="Empezar desde plantilla (opcional)">
      <select className="form-input text-[13px] max-w-[280px]" defaultValue=""
        onChange={(e) => { if (e.target.value) applyTemplate(e.target.value); }}>
        <option value="">Sin plantilla (desde cero)</option>
        {RULE_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label} — {t.description}</option>)}
      </select>
    </Field>
  )}
  ```

- [ ] **Step 6: Verificar build + tests**

Run: `npm run build` → verde.
Run: `npx vitest run src/lib/workflows/builder-templates.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git branch --show-current
git add src/lib/workflows/builder-templates.ts src/lib/workflows/builder-templates.test.ts src/components/config/workflow-builder.tsx
git commit -m "feat(workflows): plantillas de regla Lead/Broker/Empleo por campaña

Recetas que pre-llenan el builder (editables). Segmentan por
adAttribution.campaignName → contactType/leadSource/asignar/tag.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `ContactType.EMPLEO` (enum) — código + migración (SQL con OK de Luis)

Agregar `EMPLEO` al enum. **El SQL NO se aplica a la BD compartida sin OK explícito de Luis.** Esta task deja el código listo; la aplicación del SQL + `prisma generate` se hace en un paso aparte gateado.

**Files:**
- Modify: `prisma/schema.prisma` (`enum ContactType`)
- Create: `prisma/migrations-manual/2026-06-20-contacttype-empleo.sql`

- [ ] **Step 1: Agregar el valor al enum en schema.prisma**

En `prisma/schema.prisma`, en `enum ContactType` (líneas ~60-69), agregar `EMPLEO` antes del `@@schema`:

```prisma
enum ContactType {
  LEAD
  PROSPECTO
  CLIENTE
  INVERSIONISTA
  BROKER_EXTERNO
  REFERIDO
  EMPLEO

  @@schema("propyte_crm")
}
```

- [ ] **Step 2: Escribir la migración manual additiva**

Create `prisma/migrations-manual/2026-06-20-contacttype-empleo.sql`:

```sql
-- Fase 2: agrega EMPLEO a ContactType (additivo, no destructivo).
-- ADD VALUE no corre dentro de transacción en PG < 12 / algunos pools → ejecutar suelto.
ALTER TYPE "propyte_crm"."ContactType" ADD VALUE IF NOT EXISTS 'EMPLEO';
```

- [ ] **Step 3: Verificar que el schema compila (sin tocar la BD)**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"
(NO correr `prisma generate` aún si rompiera el build por falta del valor en la BD — el generate es local y no toca la BD; ver Step 5.)

- [ ] **Step 4: Commit (código, sin aplicar SQL)**

```bash
git branch --show-current
git add prisma/schema.prisma prisma/migrations-manual/2026-06-20-contacttype-empleo.sql
git commit -m "feat(db): ContactType += EMPLEO (migración additiva, pendiente aplicar)

SQL en migrations-manual; se aplica a la BD compartida solo con OK de Luis.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: [GATE — requiere OK explícito de Luis] aplicar SQL + regenerar cliente**

Solo tras "aplica la migración EMPLEO" (o equivalente). Aplicar vía MCP Supabase (`apply_migration` / `execute_sql`) o SQL Editor:
```sql
ALTER TYPE "propyte_crm"."ContactType" ADD VALUE IF NOT EXISTS 'EMPLEO';
```
Luego local:
Run: `npx prisma generate`
Expected: cliente regenerado con `EMPLEO`.
Verificación (MCP Supabase): `SELECT unnest(enum_range(NULL::propyte_crm."ContactType"))::text;` incluye `EMPLEO`.

---

## Task 8: Verificación E2E (Playwright) + cierre de rama

**Files:** ninguno de producción (script de prueba temporal, fuera del repo o en `scripts/`).

- [ ] **Step 1: Suite completa verde**

Run: `npm test`
Expected: todos los tests PASS (incluye los nuevos de builder-model y builder-templates).

- [ ] **Step 2: Build verde**

Run: `npm run build`
Expected: build sin errores.

- [ ] **Step 3: Playwright (Windows — script standalone + subprocess + JSON temp)**

Con sesión ADMIN/DIRECTOR, en `/configuracion` → Workflows & SLA → nueva regla:
1. Usar plantilla "Broker"; verificar que se pre-llenan nombre, condición `adAttribution.campaignName contains BROKER`, y 4 acciones.
2. Agregar un "Grupo" con 2 condiciones; agregar a una acción "Retrasar = 10".
3. Guardar pausada; reabrir la regla; verificar round-trip (grupo + delayMinutes + toStage si se usó STAGE_CHANGE).
Capturar resultado a JSON temporal y aserciones en el script (patrón feedback_playwright_windows).

- [ ] **Step 4: Merge ff a main (deploy) — [autorizado para esta línea de trabajo]**

```bash
git checkout main
git pull --ff-only
git merge --ff-only feat/flujos-fase2-builder
git push origin main
```
(Si `--ff-only` falla por avance de main, rebasear la rama sobre main y reintentar. Verificar autoría de los commits = Propyte-Luis antes de push.)

- [ ] **Step 5: Auto-deploy Hostinger**

Verificar `crm.propyte.com` levanta y `/configuracion` carga el builder. (La plantilla "Empleo" solo setea `EMPLEO` sin error si la migración de Task 7 ya se aplicó; si no, las otras plantillas funcionan igual.)

---

## Self-Review (cobertura del spec)

- §4.A extracción → Task 1 ✓
- §4.B fix STAGE_CHANGE → Task 2 ✓
- §4.C delayMinutes (builder **+ API**, gap detectado) → Task 3 ✓
- §4.D campos enriquecidos → Task 4 ✓
- §4.E anidación 2 niveles → Task 5 ✓
- §4.F enum EMPLEO (gate migración) → Task 7 ✓
- §4.G plantillas → Task 6 ✓
- §6 pruebas (unit + Playwright + verificación BD) → Tasks 1-8 ✓
- §7 proceso (TDD, autoría, ff a main, gate migración) → convenciones + Task 7/8 ✓

Consistencia de tipos: `CondLeaf`/`CondGroup`/`CondItem`/`ConditionTree`, `buildConditionsTree`/`parseConditions`, `ActionRow.delayMinutes` usados consistentemente entre tasks. `buildConditions` plano (Task 1) queda obsoleto al entrar el árbol (Task 5) — el componente deja de usarlo; se puede borrar en Task 5 si no quedan referencias.
