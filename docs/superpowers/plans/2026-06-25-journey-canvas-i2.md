# Journey Canvas i2 — Write-back grafo→motor · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer editable la vista Dirigida del canvas de journey, escribiendo de vuelta a una `AutomationRule` real vía la API existente, con commit explícito.

**Architecture:** Borrador-objeto como fuente de verdad. `RuleDraft` tiene la **misma forma** que `AutomationRule` (con `nodeId` cliente en cada acción). El lienzo (`draftToFlow`) y el inspector son proyecciones del draft; las ops puras devuelven drafts nuevos (inmutables). Al Guardar, `draftToRulePayload` produce exactamente el `ruleSchema` que ya validan `POST/PUT /api/admin/automation/rules`. Sin compilador de grafo, sin endpoints nuevos, sin migración.

**Tech Stack:** Next.js 14 (App Router), TypeScript, React, `@xyflow/react` v12, Vitest, Prisma. Editor de condiciones reusado: `src/components/config/condition-tree.tsx`. Validación reusada: `src/lib/validations/rebuild-f1.ts` (`conditionsDslSchema`, `workflowActionTypes`).

**Worktree:** `.claude/worktrees/crm-journey-canvas-i2`, rama `feat/crm-journey-canvas-i2` (base `origin/main`=`0adf008`). Verificar `git branch --show-current` antes de cada commit (worktree compartido brinca de rama).

**Gotcha obligatorio:** tras CUALQUIER `npm install`, correr `npx prisma generate` (normal, NO `--no-engine`) antes de typecheck/build, o el cliente Prisma queda stale y `tsc` tira errores falsos.

---

## File Structure

- **Create** `src/lib/journey/rule-draft.ts` — núcleo puro: tipos `RuleDraft`/`ActionDraft`, `ruleToDraft`, `draftToRulePayload`, `draftToFlow`, y ops puras. Sin React, sin imports de React Flow.
- **Create** `src/lib/journey/rule-draft.test.ts` — tests unitarios del núcleo.
- **Create** `src/components/journey/use-rule-draft.ts` — hook cliente: estado del draft + `isDirty` + ops envueltas + `save()`/`discard()`.
- **Create** `src/components/journey/rule-inspector-panel.tsx` — panel derecho; campos según tipo de nodo seleccionado.
- **Modify** `src/components/journey/journey-map-view.tsx` — modo edición en vista Dirigida: selección de nodo, inspector, Guardar, crear regla, deep-link de cadencia.
- **Reference (leer, no modificar)** `src/lib/validations/rebuild-f1.ts`, `src/components/config/condition-tree.tsx`, `src/app/api/admin/automation/rules/route.ts`.

---

## Task 1: Núcleo `RuleDraft` — conversiones y round-trip

**Files:**
- Create: `src/lib/journey/rule-draft.ts`
- Test: `src/lib/journey/rule-draft.test.ts`

Primero leer `src/lib/validations/rebuild-f1.ts` para importar el tipo de condiciones y `workflowActionTypes`, y confirmar el nombre exacto del tipo exportado (p.ej. `ConditionsDsl`/`ConditionNode`). Si no exporta un tipo, usar `z.infer<typeof conditionsDslSchema>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/journey/rule-draft.test.ts
import { describe, it, expect } from "vitest";
import { ruleToDraft, draftToRulePayload, type RuleRow } from "./rule-draft";

const ROW: RuleRow = {
  id: "r1",
  name: "Speed to lead Meta",
  description: "Bienvenida inmediata",
  triggerType: "EVENT",
  triggerConfig: { eventType: "lead.captured" },
  conditions: { all: [{ field: "adAttribution.platform", op: "eq", value: "META" }] },
  actions: [
    { type: "SEND_WHATSAPP", config: { template: "bienvenida" }, delayMinutes: 0 },
    { type: "ASSIGN", config: { mode: "ROUND_ROBIN" } },
    { type: "CHANGE_STAGE", config: { toStage: "MQL" } },
  ],
  cooldownMinutes: 60,
  priority: 100,
  isActive: true,
};

describe("ruleToDraft / draftToRulePayload", () => {
  it("añade nodeId estable a cada acción", () => {
    const d = ruleToDraft(ROW);
    expect(d.actions.map((a) => a.nodeId)).toEqual(["a0", "a1", "a2"]);
    expect(d.id).toBe("r1");
  });

  it("round-trip: draftToRulePayload(ruleToDraft(row)) reproduce el payload canónico", () => {
    const payload = draftToRulePayload(ruleToDraft(ROW));
    expect(payload).toEqual({
      id: "r1",
      name: "Speed to lead Meta",
      description: "Bienvenida inmediata",
      triggerType: "EVENT",
      triggerConfig: { eventType: "lead.captured" },
      conditions: { all: [{ field: "adAttribution.platform", op: "eq", value: "META" }] },
      actions: [
        { type: "SEND_WHATSAPP", config: { template: "bienvenida" }, delayMinutes: 0 },
        { type: "ASSIGN", config: {} },
        { type: "CHANGE_STAGE", config: { toStage: "MQL" } },
      ],
      cooldownMinutes: 60,
      priority: 100,
      isActive: true,
    });
  });

  it("regla nueva (sin id) no incluye id en el payload", () => {
    const payload = draftToRulePayload({ ...ruleToDraft(ROW), id: undefined });
    expect("id" in payload).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts`
Expected: FAIL (módulo no existe / export no encontrado).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/journey/rule-draft.ts
// Núcleo puro del canvas editable (C.2-i2). Sin React, sin React Flow.
// El draft tiene la MISMA forma que AutomationRule → round-trip exacto.
import type { Flow, RFNode, RFEdge } from "./flow-adapter";
import { conditionsDslSchema } from "@/lib/validations/rebuild-f1";
import type { z } from "zod";

export type Conditions = z.infer<typeof conditionsDslSchema>;

/** Forma de la fila AutomationRule que consumimos (campos editables). */
export interface RuleRow {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Conditions;
  actions: { type: string; config?: Record<string, unknown>; delayMinutes?: number }[];
  cooldownMinutes: number | null;
  priority: number;
  isActive: boolean;
}

export interface ActionDraft {
  nodeId: string; // cliente: "a0","a1",... — estable mientras no cambie el orden
  type: string;
  config: Record<string, unknown>;
  delayMinutes?: number;
}

export interface RuleDraft {
  id?: string; // undefined = regla nueva
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Conditions;
  actions: ActionDraft[];
  cooldownMinutes: number | null;
  priority: number;
  isActive: boolean;
}

/** Payload que consume POST/PUT /api/admin/automation/rules (ruleSchema). */
export interface RulePayload {
  id?: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Conditions;
  actions: { type: string; config: Record<string, unknown>; delayMinutes?: number }[];
  cooldownMinutes: number | null;
  priority: number;
  isActive: boolean;
}

export function ruleToDraft(row: RuleRow): RuleDraft {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerType: row.triggerType,
    triggerConfig: row.triggerConfig ?? {},
    conditions: row.conditions ?? {},
    actions: (Array.isArray(row.actions) ? row.actions : []).map((a, i) => ({
      nodeId: `a${i}`,
      type: a.type,
      config: a.config ?? {},
      ...(a.delayMinutes !== undefined ? { delayMinutes: a.delayMinutes } : {}),
    })),
    cooldownMinutes: row.cooldownMinutes,
    priority: row.priority,
    isActive: row.isActive,
  };
}

export function draftToRulePayload(draft: RuleDraft): RulePayload {
  const payload: RulePayload = {
    name: draft.name,
    description: draft.description,
    triggerType: draft.triggerType,
    triggerConfig: draft.triggerConfig,
    conditions: draft.conditions,
    actions: draft.actions.map((a) => ({
      type: a.type,
      config: a.config,
      ...(a.delayMinutes !== undefined ? { delayMinutes: a.delayMinutes } : {}),
    })),
    cooldownMinutes: draft.cooldownMinutes,
    priority: draft.priority,
    isActive: draft.isActive,
  };
  if (draft.id) payload.id = draft.id;
  return payload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/journey/rule-draft.ts src/lib/journey/rule-draft.test.ts
git commit -m "feat(journey): RuleDraft + round-trip ruleToDraft/draftToRulePayload (i2)"
```

---

## Task 2: `draftToFlow` — proyección al lienzo

**Files:**
- Modify: `src/lib/journey/rule-draft.ts`
- Test: `src/lib/journey/rule-draft.test.ts`

Renderiza el draft como cadena lineal con IDs estables: `trigger` → `condition` (solo si hay condiciones) → un nodo por acción (`a{i}`). Las acciones `CHANGE_STAGE` usan `type:"stage"` para estilo; el resto `type:"action"`. El `data` lleva la config real (no solo label) para que el inspector la lea.

- [ ] **Step 1: Write the failing test**

```ts
// añadir a src/lib/journey/rule-draft.test.ts
import { draftToFlow } from "./rule-draft";

describe("draftToFlow", () => {
  it("cadena trigger→condition→acciones con IDs estables", () => {
    const flow = draftToFlow(ruleToDraft(ROW));
    expect(flow.nodes.map((n) => n.id)).toEqual(["trigger", "condition", "a0", "a1", "a2"]);
    expect(flow.nodes.map((n) => n.type)).toEqual(["trigger", "condition", "action", "action", "stage"]);
    // edges secuenciales
    expect(flow.edges.map((e) => [e.source, e.target])).toEqual([
      ["trigger", "condition"], ["condition", "a0"], ["a0", "a1"], ["a1", "a2"],
    ]);
  });

  it("omite el nodo condición cuando conditions está vacío ({})", () => {
    const d = ruleToDraft({ ...ROW, conditions: {} as never });
    const flow = draftToFlow(d);
    expect(flow.nodes.map((n) => n.id)).toEqual(["trigger", "a0", "a1", "a2"]);
    expect(flow.edges[0]).toMatchObject({ source: "trigger", target: "a0" });
  });

  it("el data de cada acción lleva type y config reales", () => {
    const flow = draftToFlow(ruleToDraft(ROW));
    const a0 = flow.nodes.find((n) => n.id === "a0")!;
    expect(a0.data).toMatchObject({ actionType: "SEND_WHATSAPP", config: { template: "bienvenida" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts`
Expected: FAIL (`draftToFlow` no existe).

- [ ] **Step 3: Write minimal implementation**

```ts
// añadir a src/lib/journey/rule-draft.ts
const LANE_W = 240;

function conditionsEmpty(c: Conditions): boolean {
  if (!c || typeof c !== "object") return true;
  const o = c as Record<string, unknown>;
  const all = Array.isArray(o.all) ? o.all.length : 0;
  const any = Array.isArray(o.any) ? o.any.length : 0;
  return all === 0 && any === 0 && typeof o.field !== "string";
}

export function draftToFlow(draft: RuleDraft): Flow {
  const nodes: RFNode[] = [];
  const edges: RFEdge[] = [];
  let x = 0;
  const push = (id: string, type: string, data: Record<string, unknown>) => {
    nodes.push({ id, type, position: { x: x * LANE_W, y: 0 }, data });
    x++;
  };
  push("trigger", "trigger", { triggerType: draft.triggerType, triggerConfig: draft.triggerConfig, label: draft.name });
  if (!conditionsEmpty(draft.conditions)) {
    push("condition", "condition", { conditions: draft.conditions });
  }
  for (const a of draft.actions) {
    const isStage = a.type === "CHANGE_STAGE";
    push(a.nodeId, isStage ? "stage" : "action", { actionType: a.type, config: a.config, delayMinutes: a.delayMinutes });
  }
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ id: `${nodes[i - 1].id}->${nodes[i].id}`, source: nodes[i - 1].id, target: nodes[i].id });
  }
  return { nodes, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/journey/rule-draft.ts src/lib/journey/rule-draft.test.ts
git commit -m "feat(journey): draftToFlow proyección lineal con IDs estables (i2)"
```

---

## Task 3: Ops puras de edición

**Files:**
- Modify: `src/lib/journey/rule-draft.ts`
- Test: `src/lib/journey/rule-draft.test.ts`

Todas devuelven un `RuleDraft` nuevo (inmutable). Tras cambios en la lista de acciones, reindexar `nodeId` a `a{i}` para mantener el esquema estable.

- [ ] **Step 1: Write the failing test**

```ts
// añadir a src/lib/journey/rule-draft.test.ts
import { addAction, removeAction, reorderAction, setActionConfig, setActionType, setActionDelay, setTrigger, setConditions, setMeta } from "./rule-draft";

describe("ops puras", () => {
  const base = ruleToDraft(ROW);

  it("addAction inserta al final con nodeId reindexado y config vacío", () => {
    const d = addAction(base, "NOTIFY");
    expect(d.actions.length).toBe(4);
    expect(d.actions[3]).toMatchObject({ nodeId: "a3", type: "NOTIFY", config: {} });
    expect(base.actions.length).toBe(3); // inmutable
  });

  it("removeAction quita y reindexa nodeIds", () => {
    const d = removeAction(base, "a1");
    expect(d.actions.map((a) => a.type)).toEqual(["SEND_WHATSAPP", "CHANGE_STAGE"]);
    expect(d.actions.map((a) => a.nodeId)).toEqual(["a0", "a1"]);
  });

  it("reorderAction up mueve y reindexa", () => {
    const d = reorderAction(base, "a1", "up");
    expect(d.actions.map((a) => a.type)).toEqual(["ASSIGN", "SEND_WHATSAPP", "CHANGE_STAGE"]);
    expect(d.actions.map((a) => a.nodeId)).toEqual(["a0", "a1", "a2"]);
  });

  it("reorderAction en el borde es no-op", () => {
    expect(reorderAction(base, "a0", "up").actions.map((a) => a.type)).toEqual(base.actions.map((a) => a.type));
  });

  it("setActionConfig hace merge superficial del config", () => {
    const d = setActionConfig(base, "a0", { template: "promo" });
    expect(d.actions[0].config).toEqual({ template: "promo" });
  });

  it("setActionType cambia el tipo y limpia el config (evita config huérfano)", () => {
    const d = setActionType(base, "a0", "MAKE_CALL");
    expect(d.actions[0]).toMatchObject({ nodeId: "a0", type: "MAKE_CALL", config: {} });
  });

  it("setActionDelay fija delayMinutes en la acción (no en config)", () => {
    const d = setActionDelay(base, "a0", 15);
    expect(d.actions[0].delayMinutes).toBe(15);
    expect(d.actions[0].config).toEqual({ template: "bienvenida" });
  });

  it("setTrigger reemplaza tipo y config", () => {
    const d = setTrigger(base, { triggerType: "STAGE_CHANGE", triggerConfig: { toStage: "SQL" } });
    expect(d.triggerType).toBe("STAGE_CHANGE");
    expect(d.triggerConfig).toEqual({ toStage: "SQL" });
  });

  it("setConditions reemplaza el árbol", () => {
    const c = { any: [{ field: "x", op: "eq", value: 1 }] };
    expect(setConditions(base, c as never).conditions).toEqual(c);
  });

  it("setMeta hace merge de campos de regla", () => {
    const d = setMeta(base, { isActive: false, priority: 50 });
    expect(d.isActive).toBe(false);
    expect(d.priority).toBe(50);
    expect(d.name).toBe(base.name);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts`
Expected: FAIL (ops no existen).

- [ ] **Step 3: Write minimal implementation**

```ts
// añadir a src/lib/journey/rule-draft.ts
function reindex(actions: ActionDraft[]): ActionDraft[] {
  return actions.map((a, i) => ({ ...a, nodeId: `a${i}` }));
}

export function addAction(draft: RuleDraft, type: string): RuleDraft {
  return { ...draft, actions: reindex([...draft.actions, { nodeId: "", type, config: {} }]) };
}

export function removeAction(draft: RuleDraft, nodeId: string): RuleDraft {
  return { ...draft, actions: reindex(draft.actions.filter((a) => a.nodeId !== nodeId)) };
}

export function reorderAction(draft: RuleDraft, nodeId: string, dir: "up" | "down"): RuleDraft {
  const i = draft.actions.findIndex((a) => a.nodeId === nodeId);
  if (i < 0) return draft;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= draft.actions.length) return draft;
  const next = [...draft.actions];
  [next[i], next[j]] = [next[j], next[i]];
  return { ...draft, actions: reindex(next) };
}

export function setActionConfig(draft: RuleDraft, nodeId: string, patch: Record<string, unknown>): RuleDraft {
  return {
    ...draft,
    actions: draft.actions.map((a) =>
      a.nodeId === nodeId ? { ...a, config: { ...a.config, ...patch } } : a,
    ),
  };
}

export function setActionType(draft: RuleDraft, nodeId: string, type: string): RuleDraft {
  return {
    ...draft,
    actions: draft.actions.map((a) => (a.nodeId === nodeId ? { ...a, type, config: {} } : a)),
  };
}

export function setActionDelay(draft: RuleDraft, nodeId: string, minutes: number): RuleDraft {
  return {
    ...draft,
    actions: draft.actions.map((a) => (a.nodeId === nodeId ? { ...a, delayMinutes: minutes } : a)),
  };
}

export function setTrigger(draft: RuleDraft, t: { triggerType: string; triggerConfig: Record<string, unknown> }): RuleDraft {
  return { ...draft, triggerType: t.triggerType, triggerConfig: t.triggerConfig };
}

export function setConditions(draft: RuleDraft, conditions: Conditions): RuleDraft {
  return { ...draft, conditions };
}

export function setMeta(
  draft: RuleDraft,
  patch: Partial<Pick<RuleDraft, "name" | "description" | "priority" | "cooldownMinutes" | "isActive">>,
): RuleDraft {
  return { ...draft, ...patch };
}

/** Draft mínimo válido para una regla nueva (trigger + 1 acción CHANGE_STAGE). */
export function newRuleDraft(): RuleDraft {
  return {
    id: undefined,
    name: "",
    description: null,
    triggerType: "EVENT",
    triggerConfig: {},
    conditions: {} as Conditions,
    actions: [{ nodeId: "a0", type: "CHANGE_STAGE", config: {} }],
    cooldownMinutes: null,
    priority: 100,
    isActive: false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/journey/rule-draft.ts src/lib/journey/rule-draft.test.ts
git commit -m "feat(journey): ops puras de edición del draft + newRuleDraft (i2)"
```

---

## Task 4: Hook `useRuleDraft`

**Files:**
- Create: `src/components/journey/use-rule-draft.ts`
- Test: `src/lib/journey/rule-draft.test.ts` (extiende con el builder de payload de save, que es puro)

El hook es glue de cliente; la única lógica nueva testeable es la construcción del request de save, que delegamos a `draftToRulePayload` (ya probado). Mantener el hook delgado.

- [ ] **Step 1: Escribir el hook**

```ts
// src/components/journey/use-rule-draft.ts
"use client";
import { useCallback, useMemo, useState } from "react";
import {
  type RuleDraft, type RuleRow, ruleToDraft, draftToRulePayload, newRuleDraft,
  addAction, removeAction, reorderAction, setActionConfig, setActionType, setActionDelay, setTrigger, setConditions, setMeta,
  type Conditions,
} from "@/lib/journey/rule-draft";

export function useRuleDraft() {
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((row: RuleRow) => {
    const d = ruleToDraft(row);
    setDraft(d);
    setBaseline(JSON.stringify(draftToRulePayload(d)));
    setError(null);
  }, []);

  const startNew = useCallback(() => {
    const d = newRuleDraft();
    setDraft(d);
    setBaseline(""); // siempre dirty
    setError(null);
  }, []);

  const isDirty = useMemo(
    () => (draft ? JSON.stringify(draftToRulePayload(draft)) !== baseline : false),
    [draft, baseline],
  );

  const ops = useMemo(() => ({
    addAction: (type: string) => setDraft((d) => (d ? addAction(d, type) : d)),
    removeAction: (nodeId: string) => setDraft((d) => (d ? removeAction(d, nodeId) : d)),
    reorderAction: (nodeId: string, dir: "up" | "down") => setDraft((d) => (d ? reorderAction(d, nodeId, dir) : d)),
    setActionConfig: (nodeId: string, patch: Record<string, unknown>) => setDraft((d) => (d ? setActionConfig(d, nodeId, patch) : d)),
    setActionType: (nodeId: string, type: string) => setDraft((d) => (d ? setActionType(d, nodeId, type) : d)),
    setActionDelay: (nodeId: string, minutes: number) => setDraft((d) => (d ? setActionDelay(d, nodeId, minutes) : d)),
    setTrigger: (t: { triggerType: string; triggerConfig: Record<string, unknown> }) => setDraft((d) => (d ? setTrigger(d, t) : d)),
    setConditions: (c: Conditions) => setDraft((d) => (d ? setConditions(d, c) : d)),
    setMeta: (patch: Parameters<typeof setMeta>[1]) => setDraft((d) => (d ? setMeta(d, patch) : d)),
  }), []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;
    setSaving(true);
    setError(null);
    const payload = draftToRulePayload(draft);
    const method = draft.id ? "PUT" : "POST";
    const res = await fetch("/api/admin/automation/rules", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.error ?? "No se pudo guardar");
      return false;
    }
    const body = await res.json();
    load(body.data); // re-sincroniza baseline desde la fila persistida
    return true;
  }, [draft, load]);

  const discard = useCallback(() => setDraft(null), []);

  return { draft, isDirty, saving, error, load, startNew, ops, save, discard };
}
```

- [ ] **Step 2: Test del builder de payload (puro)**

```ts
// añadir a src/lib/journey/rule-draft.test.ts
describe("save payload selection", () => {
  it("regla existente → método PUT incluye id; nueva → POST sin id", () => {
    expect("id" in draftToRulePayload(ruleToDraft(ROW))).toBe(true);
    expect("id" in draftToRulePayload(newRuleDraft())).toBe(false);
  });
});
```

Run: `npx vitest run src/lib/journey/rule-draft.test.ts` → PASS (17 tests).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en `use-rule-draft.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/components/journey/use-rule-draft.ts src/lib/journey/rule-draft.test.ts
git commit -m "feat(journey): hook useRuleDraft (estado draft + dirty + save) (i2)"
```

---

## Task 5: `RuleInspectorPanel`

**Files:**
- Create: `src/components/journey/rule-inspector-panel.tsx`

Antes de escribir, leer `src/components/config/condition-tree.tsx` para confirmar sus props (cómo recibe/emite el árbol de condiciones) y `src/lib/validations/rebuild-f1.ts` para `workflowActionTypes`. Reusar las clases del CRM (`form-input`, `btn-primary`, `btn-secondary`, vars `--text/border/bg-*`) — NO inventar estilos (ver [[feedback_ui_craft_no_admin_template]]).

El panel recibe el nodo seleccionado y el draft, y emite cambios vía callbacks (las ops del hook). Renderiza según `selected`:
- `null` → meta de la regla (name/description/priority/cooldown/isActive) o vacío.
- `"trigger"` → selector `triggerType` (TRIGGER_TYPES) + textarea JSON de `triggerConfig` (i2: JSON crudo validado; UI por-tipo se pule en i3).
- `"condition"` → `<ConditionTree value={draft.conditions} onChange={ops.setConditions} />`.
- acción (`a{i}`) → selector `WorkflowActionType` + textarea JSON de `config` + `delayMinutes` + ↑↓ + borrar. Si `type==="CHANGE_STAGE"`, además un selector de etapa (LIFECYCLE_ORDER) que escribe `config.toStage`.

- [ ] **Step 1: Escribir el componente**

```tsx
// src/components/journey/rule-inspector-panel.tsx
"use client";
import { useState } from "react";
import type { RuleDraft } from "@/lib/journey/rule-draft";
import { workflowActionTypes } from "@/lib/validations/rebuild-f1";
import { LIFECYCLE_ORDER, LIFECYCLE_LABELS } from "@/lib/constants";
import { ConditionTree } from "@/components/config/condition-tree"; // confirmar nombre/exports al leer el archivo

const TRIGGER_TYPES = ["EVENT", "TIME", "BEHAVIORAL", "INACTIVITY", "STAGE_CHANGE", "SLA_BREACH", "SCORE_THRESHOLD"];

interface Ops {
  addAction: (type: string) => void;
  removeAction: (nodeId: string) => void;
  reorderAction: (nodeId: string, dir: "up" | "down") => void;
  setActionConfig: (nodeId: string, patch: Record<string, unknown>) => void;
  setActionType: (nodeId: string, type: string) => void;
  setActionDelay: (nodeId: string, minutes: number) => void;
  setTrigger: (t: { triggerType: string; triggerConfig: Record<string, unknown> }) => void;
  setConditions: (c: RuleDraft["conditions"]) => void;
  setMeta: (patch: Partial<Pick<RuleDraft, "name" | "description" | "priority" | "cooldownMinutes" | "isActive">>) => void;
}

export function RuleInspectorPanel({ draft, selectedId, ops }: { draft: RuleDraft; selectedId: string | null; ops: Ops }) {
  const action = selectedId?.startsWith("a") ? draft.actions.find((a) => a.nodeId === selectedId) : undefined;

  if (selectedId === "trigger") {
    return (
      <aside className="journey-inspector">
        <h3 className="label">Disparador</h3>
        <select className="form-input" value={draft.triggerType}
          onChange={(e) => ops.setTrigger({ triggerType: e.target.value, triggerConfig: draft.triggerConfig })}>
          {TRIGGER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <JsonField label="triggerConfig" value={draft.triggerConfig}
          onChange={(v) => ops.setTrigger({ triggerType: draft.triggerType, triggerConfig: v })} />
      </aside>
    );
  }
  if (selectedId === "condition") {
    return (
      <aside className="journey-inspector">
        <h3 className="label">Condición</h3>
        <ConditionTree value={draft.conditions} onChange={ops.setConditions} />
      </aside>
    );
  }
  if (action) {
    return (
      <aside className="journey-inspector">
        <h3 className="label">Acción</h3>
        <select className="form-input" value={action.type}
          onChange={(e) => ops.setActionType(action.nodeId, e.target.value)}>
          {workflowActionTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {action.type === "CHANGE_STAGE" && (
          <select className="form-input" value={String(action.config.toStage ?? "")}
            onChange={(e) => ops.setActionConfig(action.nodeId, { toStage: e.target.value })}>
            <option value="">— etapa —</option>
            {LIFECYCLE_ORDER.map((s) => <option key={s} value={s}>{LIFECYCLE_LABELS[s] ?? s}</option>)}
          </select>
        )}
        <JsonField label="config" value={action.config} onChange={(v) => ops.setActionConfig(action.nodeId, v)} />
        <label className="label">Retraso (min)</label>
        <input className="form-input" type="number" min={0} value={action.delayMinutes ?? 0}
          onChange={(e) => ops.setActionDelay(action.nodeId, Number(e.target.value))} />
        <div className="inspector-actions">
          <button className="btn-secondary" onClick={() => ops.reorderAction(action.nodeId, "up")}>↑</button>
          <button className="btn-secondary" onClick={() => ops.reorderAction(action.nodeId, "down")}>↓</button>
          <button className="btn-secondary" onClick={() => ops.removeAction(action.nodeId)}>Borrar</button>
        </div>
      </aside>
    );
  }
  // meta de la regla
  return (
    <aside className="journey-inspector">
      <h3 className="label">Regla</h3>
      <input className="form-input" placeholder="Nombre" value={draft.name} onChange={(e) => ops.setMeta({ name: e.target.value })} />
      <textarea className="form-input" placeholder="Descripción" value={draft.description ?? ""} onChange={(e) => ops.setMeta({ description: e.target.value || null })} />
      <input className="form-input" type="number" min={1} max={1000} value={draft.priority} onChange={(e) => ops.setMeta({ priority: Number(e.target.value) })} />
      <label className="label"><input type="checkbox" checked={draft.isActive} onChange={(e) => ops.setMeta({ isActive: e.target.checked })} /> Activa</label>
      <select className="form-input" value={String(draft.actions.length)} disabled>
        <option>{draft.actions.length} acciones</option>
      </select>
      <button className="btn-secondary" onClick={() => ops.addAction("NOTIFY")}>+ Añadir acción</button>
    </aside>
  );
}

function JsonField({ label, value, onChange }: { label: string; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <div>
      <label className="label">{label}</label>
      <textarea className="form-input" rows={4} value={text} onChange={(e) => {
        setText(e.target.value);
        try { onChange(JSON.parse(e.target.value)); setBad(false); } catch { setBad(true); }
      }} />
      {bad && <span style={{ color: "var(--danger, #b91c1c)", fontSize: 12 }}>JSON inválido</span>}
    </div>
  );
}
```

> **Nota para el implementer:** `setActionType` limpia el `config` al cambiar de tipo (evita config huérfano de otro tipo) — avisar visualmente si el config tenía datos. `JsonField` mantiene su propio `text` local; al cambiar de nodo seleccionado, el componente se remonta (key por `selectedId`) para re-sincronizar el textarea con el config del nuevo nodo. Confirmar las props reales de `ConditionTree` al leer `condition-tree.tsx`; si su contrato (value/onChange) difiere, **envolver**, no reescribir.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` → sin errores. Si se añadieron ops nuevas, primero su test en `rule-draft.test.ts` (rojo→verde).

- [ ] **Step 3: Commit**

```bash
git add src/components/journey/rule-inspector-panel.tsx src/lib/journey/rule-draft.ts src/lib/journey/rule-draft.test.ts
git commit -m "feat(journey): RuleInspectorPanel campos por tipo de nodo (i2)"
```

---

## Task 6: Integración en `journey-map-view.tsx`

**Files:**
- Modify: `src/components/journey/journey-map-view.tsx`

Leer el archivo completo primero (≤120 líneas). Añadir, **solo en la vista Dirigida**:
1. Estado `selectedId` + `useRuleDraft`. Al entrar a Dirigida con una regla elegida, `load(rule)` (la vista Dirigida hoy puede mostrar varias reglas filtradas por campaña; en i2 se edita **una** regla a la vez — añadir un selector de regla si la vista Dirigida agrupa varias, o editar la regla del flujo seleccionado).
2. Render del lienzo desde `draftToFlow(draft)` cuando hay draft en edición (en vez de `targetedToFlow`); `applyPositions` con el layout como i1. `nodesConnectable={false}` se mantiene.
3. `onNodeClick` → `setSelectedId(node.id)` → muestra `<RuleInspectorPanel>`.
4. Barra de acciones: botón **Guardar** (deshabilitado si `!isDirty`), indicador dirty, **Descartar**, **+ Crear regla** (`startNew`).
5. **Confirmación al guardar regla activa:** si `draft.isActive`, `window.confirm("Esta regla está activa: los cambios aplican a disparos nuevos. ¿Guardar?")` antes de `save()`. Mostrar `error` del hook si falla.
6. **Cadencia read-only:** click en un nodo `type==="cadence"` NO abre inspector editable; navega a `/configuracion` (deep-link al editor de cadencias) — `window.open("/configuracion", "_self")` o `router.push`.
7. El drag de React Flow sigue persistiendo posiciones como i1 (no tocar esa lógica).

- [ ] **Step 1: Leer el archivo y aplicar la integración** (mostrar el diff completo en el PR; la estructura sigue el patrón existente del componente).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build verde. (Si se instaló algo, `npx prisma generate` antes.)

- [ ] **Step 3: Commit**

```bash
git add src/components/journey/journey-map-view.tsx
git commit -m "feat(journey): vista Dirigida editable — inspector, guardar, crear, deep-link cadencia (i2)"
```

---

## Task 7: Verificación end-to-end + suite completa

**Files:** ninguno (verificación).

- [ ] **Step 1: Suite completa de tests**

Run: `npx vitest run`
Expected: todos verdes (los previos + ~15 nuevos de `rule-draft.test.ts`).

- [ ] **Step 2: Build de producción**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Smoke autenticado con Playwright MCP** (login ADMIN, `/journey`):
  - Cambiar a vista Dirigida → seleccionar una regla → click en un nodo de acción → el inspector muestra sus campos.
  - Editar `config` → el indicador dirty se activa → Guardar → (si activa) aparece el confirm → aceptar → toast/refresh OK.
  - Verificar vía MCP Supabase que la fila `AutomationRule` refleja el cambio (`execute_sql` SELECT de `actions`).
  - Click en un nodo de cadencia → navega a `/configuracion` (no inspector editable).
  - **OJO prod:** las reglas reales están activas en prod (BD compartida). Para el smoke, crear una regla de prueba **inactiva** (`startNew`, isActive=false) y editar/borrar ESA, no una viva. Borrar la de prueba al terminar.

- [ ] **Step 4: Commit final si hubo ajustes del smoke** (si no, nada).

---

## Notas de cierre (no son tasks)

- **Sin migración** → no hay gate de infra; el push puede ir tras review.
- Al terminar: review holístico (subagent-driven hace review por task), luego ff-push a `main` con autor `Propyte-Luis` y auto-deploy Hostinger.
- Actualizar `project_propyte_crm.md` (changelog) y `~/Desktop/Pendientes_Tracker.md` al cierre.
- **Siguiente sub-proyecto Fase 3:** C.2-i3 (paleta + ramas + pulido), luego D / E / F.
