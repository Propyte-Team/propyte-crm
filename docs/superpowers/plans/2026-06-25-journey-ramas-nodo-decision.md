# Ramas en el motor de workflows — Nodo de decisión (árbol) · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una `AutomationRule` pueda contener un árbol de decisión (nodos de acción + nodos de decisión recursivos), de modo que un solo workflow bifurque multi-vía y anidado según los datos del contacto/deal, ejecutando solo el camino tomado.

**Architecture:** `AutomationRule.actions` (JSONB) pasa de lista plana `ActionSpec[]` a árbol `WorkflowNode[]` (`ActionNode | DecisionNode`). Un walker recursivo puro (`walkNodes`) recorre el árbol con el contexto del DSL y devuelve solo las acciones del camino tomado; lo reutilizan `engine.ts` y `scheduler.ts`. El canvas editable (i2/i3) se extiende: el draft del cliente vuelve árbol, `draftToFlow` proyecta rombos de decisión con una arista por rama, y el inspector edita ramas reusando `ConditionTreeEditor`. Sin migración (es JSONB) y compatible hacia atrás (lista plana = árbol de puros nodos-acción).

**Tech Stack:** TypeScript, Next.js 14 (App Router), Prisma + Supabase Postgres, Zod, React Flow (`@xyflow/react` v12), Vitest (suite actual ~353 tests).

**Fases:**
- **Fase 1 (Tareas 1–6):** modelo zod + walker + engine + scheduler + API. Al terminar, las ramas funcionan end-to-end vía API/seed; **desplegable sola**.
- **Fase 2 (Tareas 7–12):** canvas — draft árbol, ops, `draftToFlow`, paleta, inspector, wiring de la vista.

**Convenciones del repo (leer antes de empezar):**
- Tests con Vitest: `npx vitest run <ruta>` para un archivo, `npx vitest run` para todo.
- Typecheck: `npx tsc --noEmit`. Build: `npm run build`.
- **GOTCHA obligatorio:** tras CUALQUIER `npm install`, correr `npx prisma generate` antes de typecheck/build (deja el cliente stale → errores falsos). En este plan NO hay `npm install` (cero deps nuevas), pero si algo lo dispara, regenerar.
- Autor de commits: `Propyte-Luis` / `webkoi@webkoi-ai.com` (ya configurado en este worktree). Verificar antes de cada commit con `git config user.name`.
- Trabajamos en el worktree `.claude/worktrees/crm-journey-ramas` (rama `feat/crm-journey-ramas` desde `origin/main` `f8cbd7c`). Todas las rutas son relativas a la raíz del repo.

---

## File Structure

**Crear:**
- `src/lib/workflows/walk-nodes.ts` — walker recursivo puro: `walkNodes(nodes, ctx) → EnqueueSpec[]`. Única lógica de "qué camino tomar".
- `src/lib/workflows/walk-nodes.test.ts` — tests del walker.
- `src/components/journey/decision-inspector.tsx` — editor del nodo de decisión (lista de ramas + `ConditionTreeEditor` por rama + `else`).

**Modificar:**
- `src/lib/validations/rebuild-f1.ts` — agregar `actionNodeSchema`, `branchSchema`, `decisionNodeSchema`, `workflowNodeSchema` (recursivo `z.lazy`), `workflowActionsSchema`, y tipos `WorkflowNode`/`DecisionNode`/`Branch`. `actionSpecSchema` se mantiene (lo usan otros módulos).
- `src/lib/workflows/engine.ts` — `processEvent` valida `rule.actions` con `workflowActionsSchema` y encola con `walkNodes` (dedupeKey por `path`).
- `src/lib/workflows/scheduler.ts` — `runInactivityRules` usa el mismo `walkNodes`.
- `src/app/api/admin/automation/rules/route.ts` — `ruleSchema.actions` pasa de array plano a `workflowActionsSchema`.
- `src/lib/journey/rule-draft.ts` — `RuleDraft.actions` vuelve árbol (`NodeDraft[]`); ops generalizadas + nuevas para decisiones/ramas; `draftToFlow` proyecta el árbol; `ruleToDraft`/`draftToRulePayload` round-trip árbol↔fila.
- `src/lib/journey/journey-map.ts` — guarda contra nodos de decisión al listar acciones (degradación, no crash) en la vista read-only.
- `src/components/journey/rule-inspector-panel.tsx` — despacha al `DecisionInspector` cuando el nodo seleccionado es una decisión/rama; botón "+ Añadir decisión".
- `src/components/journey/node-palette.tsx` — ítem "◆ Decisión" en la paleta.
- `src/components/journey/use-rule-draft.ts` — exponer los ops nuevos.
- `src/components/journey/journey-map-view.tsx` — render del nodo decisión (rombo) + aristas por rama; selección de decisión/rama.
- `src/lib/journey/rule-draft.test.ts` — tests de ops de árbol + round-trip.
- `src/lib/journey/flow-adapter.test.ts` o el test de `draftToFlow` existente — proyección de decisión.

---

## FASE 1 — Backend

### Task 1: Esquema zod del árbol de nodos

**Files:**
- Modify: `src/lib/validations/rebuild-f1.ts` (tras `actionSpecSchema`, ~línea 48)
- Test: `src/lib/validations/rebuild-f1.test.ts` (crear si no existe; si existe, añadir un `describe`)

- [ ] **Step 1: Escribir el test que falla**

Crear/añadir en `src/lib/validations/rebuild-f1.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { workflowActionsSchema } from "./rebuild-f1";

describe("workflowActionsSchema", () => {
  it("acepta lista plana de acciones (compat hacia atrás)", () => {
    const r = workflowActionsSchema.safeParse([
      { type: "ADD_TAG", config: { tag: "x" } },
      { type: "ASSIGN", config: {}, delayMinutes: 10 },
    ]);
    expect(r.success).toBe(true);
  });

  it("acepta un nodo de decisión con ramas y else", () => {
    const r = workflowActionsSchema.safeParse([
      {
        kind: "decision",
        label: "Por origen",
        branches: [
          { label: "META", conditions: { field: "adAttribution.network", op: "eq", value: "meta" }, steps: [{ type: "ASSIGN", config: {} }] },
          { label: "WEB", conditions: {}, steps: [] },
        ],
        else: [{ type: "ADD_TAG", config: { tag: "otro" } }],
      },
    ]);
    expect(r.success).toBe(true);
  });

  it("acepta decisión anidada dentro de una rama", () => {
    const r = workflowActionsSchema.safeParse([
      {
        kind: "decision",
        branches: [
          {
            conditions: { field: "contact.contactType", op: "eq", value: "COMPRADOR" },
            steps: [
              { kind: "decision", branches: [{ conditions: { all: [{ field: "contact.score", op: "gte", value: 70 }] }, steps: [{ type: "ESCALATE", config: {} }] }] },
            ],
          },
        ],
      },
    ]);
    expect(r.success).toBe(true);
  });

  it("rechaza decisión sin ramas", () => {
    expect(workflowActionsSchema.safeParse([{ kind: "decision", branches: [] }]).success).toBe(false);
  });

  it("rechaza rama sin conditions", () => {
    expect(
      workflowActionsSchema.safeParse([{ kind: "decision", branches: [{ steps: [] }] }]).success,
    ).toBe(false);
  });

  it("rechaza tipo de acción desconocido", () => {
    expect(workflowActionsSchema.safeParse([{ type: "NOPE", config: {} }]).success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx vitest run src/lib/validations/rebuild-f1.test.ts`
Expected: FAIL — `workflowActionsSchema` no existe (import error).

- [ ] **Step 3: Implementación mínima**

En `src/lib/validations/rebuild-f1.ts`, justo **después** del bloque `actionSpecSchema` (línea ~48), agregar:

```ts
// ---------------------------------------------------------------------------
// Árbol de nodos de workflow (ramas) — AutomationRule.actions
//   Nodo = acción (ActionSpec + kind opcional) | decisión (recursiva).
//   Compat: una lista plana de ActionSpec parsea como árbol de puros nodos-acción.
// ---------------------------------------------------------------------------
export const actionNodeSchema = actionSpecSchema.extend({
  kind: z.literal("action").optional(),
});

export type WorkflowNode =
  | z.infer<typeof actionNodeSchema>
  | {
      kind: "decision";
      label?: string;
      branches: { label?: string; conditions: ConditionNode | Record<string, never>; steps: WorkflowNode[] }[];
      else?: WorkflowNode[];
    };

const branchSchema: z.ZodType<{ label?: string; conditions: ConditionNode | Record<string, never>; steps: WorkflowNode[] }> =
  z.lazy(() =>
    z.object({
      label: z.string().max(120).optional(),
      conditions: conditionsDslSchema,
      steps: z.array(workflowNodeSchema),
    }),
  ) as never;

const decisionNodeSchema: z.ZodType<Extract<WorkflowNode, { kind: "decision" }>> = z.lazy(() =>
  z.object({
    kind: z.literal("decision"),
    label: z.string().max(120).optional(),
    branches: z.array(branchSchema).min(1, "Una decisión necesita al menos una rama"),
    else: z.array(workflowNodeSchema).optional(),
  }),
) as never;

export const workflowNodeSchema: z.ZodType<WorkflowNode> = z.lazy(() =>
  z.union([decisionNodeSchema, actionNodeSchema]),
) as never;

export const workflowActionsSchema = z.array(workflowNodeSchema);
```

> Nota: `decisionNodeSchema` va **primero** en el `z.union` para que un objeto con `kind:"decision"` no intente parsear como acción. `conditionsDslSchema` y `ConditionNode` ya existen arriba en el archivo (no re-importar).

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `npx vitest run src/lib/validations/rebuild-f1.test.ts`
Expected: PASS (6 casos).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validations/rebuild-f1.ts src/lib/validations/rebuild-f1.test.ts
git commit -m "feat(workflows): esquema zod del árbol de nodos (acción|decisión recursiva)"
```

---

### Task 2: Walker recursivo puro `walkNodes`

**Files:**
- Create: `src/lib/workflows/walk-nodes.ts`
- Test: `src/lib/workflows/walk-nodes.test.ts`

- [ ] **Step 1: Escribir el test que falla**

`src/lib/workflows/walk-nodes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { walkNodes } from "./walk-nodes";
import type { WorkflowNode } from "@/lib/validations/rebuild-f1";

const ctx = {
  contact: { contactType: "COMPRADOR", score: 80 },
  adAttribution: { network: "meta" },
};

describe("walkNodes", () => {
  it("lista plana → todas las acciones, paths secuenciales", () => {
    const tree: WorkflowNode[] = [
      { type: "ADD_TAG", config: { tag: "a" } },
      { type: "ASSIGN", config: {}, delayMinutes: 5 },
    ];
    const out = walkNodes(tree, ctx);
    expect(out.map((s) => [s.actionType, s.path])).toEqual([
      ["ADD_TAG", "0"],
      ["ASSIGN", "1"],
    ]);
    expect(out[1].delayMinutes).toBe(5);
  });

  it("decisión: toma la primera rama que cumple", () => {
    const tree: WorkflowNode[] = [
      {
        kind: "decision",
        branches: [
          { conditions: { field: "adAttribution.network", op: "eq", value: "web" }, steps: [{ type: "NOTIFY", config: {} }] },
          { conditions: { field: "adAttribution.network", op: "eq", value: "meta" }, steps: [{ type: "ASSIGN", config: {} }] },
        ],
      },
    ];
    const out = walkNodes(tree, ctx);
    expect(out.map((s) => [s.actionType, s.path])).toEqual([["ASSIGN", "0.b1.0"]]);
  });

  it("decisión: cae en else si ninguna rama cumple", () => {
    const tree: WorkflowNode[] = [
      {
        kind: "decision",
        branches: [{ conditions: { field: "adAttribution.network", op: "eq", value: "web" }, steps: [{ type: "NOTIFY", config: {} }] }],
        else: [{ type: "ADD_TAG", config: { tag: "otro" } }],
      },
    ];
    const out = walkNodes(tree, ctx);
    expect(out.map((s) => [s.actionType, s.path])).toEqual([["ADD_TAG", "0.else.0"]]);
  });

  it("decisión sin rama que cumple y sin else → nada", () => {
    const tree: WorkflowNode[] = [
      { kind: "decision", branches: [{ conditions: { field: "adAttribution.network", op: "eq", value: "web" }, steps: [{ type: "NOTIFY", config: {} }] }] },
    ];
    expect(walkNodes(tree, ctx)).toEqual([]);
  });

  it("rama con conditions vacías = siempre cumple (default)", () => {
    const tree: WorkflowNode[] = [
      { kind: "decision", branches: [{ conditions: {}, steps: [{ type: "NOTIFY", config: {} }] }] },
    ];
    expect(walkNodes(tree, ctx).map((s) => s.actionType)).toEqual(["NOTIFY"]);
  });

  it("anidado: decisión dentro de rama, path compuesto", () => {
    const tree: WorkflowNode[] = [
      {
        kind: "decision",
        branches: [
          {
            conditions: { field: "contact.contactType", op: "eq", value: "COMPRADOR" },
            steps: [
              { type: "ADD_TAG", config: { tag: "comprador" } },
              {
                kind: "decision",
                branches: [{ conditions: { field: "contact.score", op: "gte", value: 70 }, steps: [{ type: "ESCALATE", config: {} }] }],
              },
            ],
          },
        ],
      },
    ];
    const out = walkNodes(tree, ctx);
    expect(out.map((s) => [s.actionType, s.path])).toEqual([
      ["ADD_TAG", "0.b0.0"],
      ["ESCALATE", "0.b0.1.b0.0"],
    ]);
  });

  it("propaga autonomyLevel a la EnqueueSpec", () => {
    const tree: WorkflowNode[] = [{ type: "AI_DRAFT", config: {}, autonomyLevel: "L2" }];
    expect(walkNodes(tree, ctx)[0].autonomyLevel).toBe("L2");
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx vitest run src/lib/workflows/walk-nodes.test.ts`
Expected: FAIL — `walk-nodes` no existe.

- [ ] **Step 3: Implementación mínima**

`src/lib/workflows/walk-nodes.ts`:

```ts
// Walker recursivo PURO del árbol de nodos de una AutomationRule (ramas).
// Entra: árbol de WorkflowNode + contexto del DSL. Sale: solo las acciones del
// camino tomado, cada una con su `path` estable (para dedupeKey idempotente).
// Sin BD, sin React → 100% testeable.
import type { WorkflowNode } from "@/lib/validations/rebuild-f1";
import { evaluateConditions } from "./evaluate-conditions";

export interface EnqueueSpec {
  actionType: string;
  config: Record<string, unknown>;
  delayMinutes?: number;
  autonomyLevel?: string;
  path: string;
}

type Ctx = Record<string, unknown>;

function isDecision(n: WorkflowNode): n is Extract<WorkflowNode, { kind: "decision" }> {
  return (n as { kind?: string }).kind === "decision";
}

export function walkNodes(nodes: WorkflowNode[], ctx: Ctx, prefix = ""): EnqueueSpec[] {
  const out: EnqueueSpec[] = [];
  nodes.forEach((node, i) => {
    const path = prefix ? `${prefix}.${i}` : String(i);
    if (isDecision(node)) {
      const branch = node.branches.find((b) => evaluateConditions(b.conditions as never, ctx));
      if (branch) {
        const bi = node.branches.indexOf(branch);
        out.push(...walkNodes(branch.steps, ctx, `${path}.b${bi}`));
      } else if (node.else && node.else.length > 0) {
        out.push(...walkNodes(node.else, ctx, `${path}.else`));
      }
      return;
    }
    const action = node as Extract<WorkflowNode, { type: string }>;
    out.push({
      actionType: action.type,
      config: (action.config ?? {}) as Record<string, unknown>,
      ...(action.delayMinutes !== undefined ? { delayMinutes: action.delayMinutes } : {}),
      ...(action.autonomyLevel !== undefined ? { autonomyLevel: action.autonomyLevel } : {}),
      path,
    });
  });
  return out;
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `npx vitest run src/lib/workflows/walk-nodes.test.ts`
Expected: PASS (7 casos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/walk-nodes.ts src/lib/workflows/walk-nodes.test.ts
git commit -m "feat(workflows): walker recursivo puro walkNodes (solo encola el camino tomado)"
```

---

### Task 3: `engine.ts` usa `walkNodes`

**Files:**
- Modify: `src/lib/workflows/engine.ts:96-117` (el bloque `const actions = ...` dentro de `processEvent`)

- [ ] **Step 1: Reemplazar el bucle lineal por el walker**

En `processEvent`, sustituir el bloque actual (desde `const actions = Array.isArray(rule.actions) ? rule.actions : [];` hasta el `}` que cierra el `for (const raw of actions)`), por:

```ts
      const parsedActions = workflowActionsSchema.safeParse(rule.actions);
      if (!parsedActions.success) {
        console.error(`[workflows] árbol de acciones inválido en regla "${rule.name}"`);
        continue;
      }
      const specs = walkNodes(parsedActions.data, ctx);
      for (const spec of specs) {
        const runAfter = new Date(Date.now() + (spec.delayMinutes ?? 0) * 60_000);
        await enqueueAction({
          ruleId: rule.id,
          actionType: spec.actionType as never,
          entityType: event.entityType,
          entityId: event.entityId,
          config: { ...spec.config, autonomyLevel: spec.autonomyLevel },
          dedupeKey: `${rule.id}:${event.entityId}:${spec.actionType}:${spec.path}:${dayBucket(runAfter)}`,
          runAfter,
        });
      }
```

Actualizar imports al inicio del archivo:

```ts
import { workflowActionsSchema } from "@/lib/validations/rebuild-f1";
import { walkNodes } from "./walk-nodes";
```

y **eliminar** el import ya-no-usado `import { actionSpecSchema } from "@/lib/validations/rebuild-f1";` (línea 6).

> El gate global `evaluateConditions(rule.conditions, ctx)` de la línea 94 se conserva intacto: decide si la regla aplica; el walker decide el camino interno.

- [ ] **Step 2: Correr la suite de workflows + typecheck**

Run: `npx vitest run src/lib/workflows && npx tsc --noEmit`
Expected: PASS — los tests existentes de engine siguen verdes (una regla sin decisiones produce el mismo encolado; solo cambió `idx`→`path`, que para lista plana es el mismo número).

> Si algún test existente asienta el dedupeKey con el índice viejo, ese path para lista plana es idéntico (`"0"`, `"1"`…), así que no debería romper. Si rompe por el formato, ajustar la expectativa del test al nuevo `path`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/engine.ts
git commit -m "feat(workflows): engine encola con walkNodes (dedupeKey por ruta de nodo)"
```

---

### Task 4: `scheduler.ts` (INACTIVITY) usa `walkNodes`

**Files:**
- Modify: `src/lib/workflows/scheduler.ts:103-120` (bloque `const actions = ...` dentro de `runInactivityRules`)

- [ ] **Step 1: Reemplazar el bucle lineal por el walker**

En `runInactivityRules`, sustituir el bloque desde `const actions = Array.isArray(rule.actions) ? ...` hasta el cierre del `for (const raw of actions)` por:

```ts
      const parsedActions = workflowActionsSchema.safeParse(rule.actions);
      if (!parsedActions.success) continue;
      const specs = walkNodes(parsedActions.data, ctx);
      let any = false;
      for (const spec of specs) {
        const enqueued = await enqueueAction({
          ruleId: rule.id,
          actionType: spec.actionType as never,
          entityType: "contact",
          entityId: contact.id,
          config: { ...spec.config, autonomyLevel: spec.autonomyLevel },
          dedupeKey: `${rule.id}:${contact.id}:${spec.actionType}:${spec.path}:${dayBucket(new Date())}`,
          runAfter: new Date(Date.now() + (spec.delayMinutes ?? 0) * 60_000),
        });
        if (enqueued) any = true;
      }
      if (any) fired++;
```

Imports al inicio:

```ts
import { workflowActionsSchema } from "@/lib/validations/rebuild-f1";
import { walkNodes } from "./walk-nodes";
```

> El `ctx` de `runInactivityRules` ya es `{ contact: {...}, context: {} }` (línea 100). El walker lo acepta tal cual.

- [ ] **Step 2: Correr suite + typecheck**

Run: `npx vitest run src/lib/workflows && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/scheduler.ts
git commit -m "feat(workflows): scheduler INACTIVITY usa el mismo walkNodes"
```

---

### Task 5: API de reglas valida el árbol

**Files:**
- Modify: `src/app/api/admin/automation/rules/route.ts:7,17-23`

- [ ] **Step 1: Cambiar `ruleSchema.actions` al esquema de árbol**

Reemplazar el campo `actions` del `ruleSchema` (líneas 17–23) por:

```ts
  actions: workflowActionsSchema.min(1, "Agrega al menos un nodo"),
```

Actualizar el import de la línea 7:

```ts
import { conditionsDslSchema, workflowActionsSchema, TRIGGER_TYPES } from "@/lib/validations/rebuild-f1";
```

(quitar `workflowActionTypes` del import si ya no se usa en el archivo — verificar con búsqueda en el archivo; si no aparece más, quitarlo).

> `prisma.automationRule.create/update` ya guarda `actions: d.actions as never` → acepta el árbol sin más cambios (columna JSONB).

- [ ] **Step 2: Test de humo del schema (rápido, sin servidor)**

Crear `src/app/api/admin/automation/rules/route.schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { workflowActionsSchema } from "@/lib/validations/rebuild-f1";

describe("ruleSchema.actions (árbol)", () => {
  it("acepta árbol con decisión vía workflowActionsSchema", () => {
    const r = workflowActionsSchema.min(1).safeParse([
      { kind: "decision", branches: [{ conditions: {}, steps: [{ type: "ASSIGN", config: {} }] }] },
    ]);
    expect(r.success).toBe(true);
  });
  it("rechaza lista vacía", () => {
    expect(workflowActionsSchema.min(1).safeParse([]).success).toBe(false);
  });
});
```

- [ ] **Step 3: Correr + typecheck**

Run: `npx vitest run src/app/api/admin/automation/rules && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/automation/rules/route.ts src/app/api/admin/automation/rules/route.schema.test.ts
git commit -m "feat(api): reglas validan árbol de nodos (workflowActionsSchema)"
```

---

### Task 6: Vista read-only (journey-map) degrada ante decisiones

**Files:**
- Modify: `src/lib/journey/journey-map.ts` (donde itera `rule.actions` para listar acciones de una regla)
- Test: `src/lib/journey/journey-map.test.ts` (añadir caso)

- [ ] **Step 1: Localizar el consumo de `actions`**

Run: `npx grep -n "actions" src/lib/journey/journey-map.ts` (o búsqueda del editor).
Identificar todo punto donde se asume que `rule.actions` es lista plana de `{type}` (p. ej. `actions.map((a) => a.type)` o `.find((a) => a.type === "SET_LIFECYCLE")`).

- [ ] **Step 2: Escribir el test que falla**

Añadir en `src/lib/journey/journey-map.test.ts` un caso que pase una regla cuyo `actions` contiene un nodo `{ kind: "decision", branches: [...] }` y verifique que la derivación **no lanza** y que las acciones dentro de las ramas se consideran (p. ej. un `SET_LIFECYCLE` dentro de una rama sigue ubicando la regla en el carril correcto). Ejemplo:

```ts
it("no se rompe con reglas que tienen nodos de decisión", () => {
  const rules = [{
    id: "r1", name: "Ramas", isActive: true, triggerType: "EVENT", triggerConfig: {}, conditions: {},
    actions: [{ kind: "decision", branches: [{ conditions: {}, steps: [{ type: "SET_LIFECYCLE", config: { toStage: "MQL" } }] }] }],
  }];
  expect(() => buildGeneralView(rules as never, [])).not.toThrow();
});
```

(Ajustar nombres/firmas a las reales de `journey-map.ts`.)

- [ ] **Step 3: Aplanar acciones para la heurística read-only**

Agregar un helper local en `journey-map.ts` que recolecte recursivamente los nodos-acción de un árbol (ramas + else) y usarlo donde antes se iteraba la lista plana:

```ts
function collectActionNodes(nodes: unknown): { type: string; config?: Record<string, unknown> }[] {
  if (!Array.isArray(nodes)) return [];
  const out: { type: string; config?: Record<string, unknown> }[] = [];
  for (const n of nodes) {
    if (n && typeof n === "object" && (n as { kind?: string }).kind === "decision") {
      const d = n as { branches?: { steps?: unknown }[]; else?: unknown };
      for (const b of d.branches ?? []) out.push(...collectActionNodes(b.steps));
      out.push(...collectActionNodes(d.else));
    } else if (n && typeof n === "object" && typeof (n as { type?: string }).type === "string") {
      out.push(n as { type: string; config?: Record<string, unknown> });
    }
  }
  return out;
}
```

Reemplazar los usos directos de `rule.actions` (para fines de "qué tipos de acción tiene") por `collectActionNodes(rule.actions)`. La heurística de etapa (`ruleStage`) que mira `SET_LIFECYCLE`/`LIFECYCLE_CHANGE` sigue funcionando sobre la lista aplanada.

- [ ] **Step 4: Correr + typecheck**

Run: `npx vitest run src/lib/journey && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/journey/journey-map.ts src/lib/journey/journey-map.test.ts
git commit -m "feat(journey): vista read-only aplana ramas sin romperse"
```

**✅ Fin de Fase 1.** En este punto las ramas funcionan end-to-end por API/seed y la vista read-only las tolera. Correr `npx vitest run && npx tsc --noEmit` completo antes de seguir. (Si se desea, esta fase es desplegable: ff-push tras smoke.)

---

## FASE 2 — Canvas editable

### Task 7: Draft árbol — tipos y round-trip `ruleToDraft`/`draftToRulePayload`

**Files:**
- Modify: `src/lib/journey/rule-draft.ts` (tipos + `ruleToDraft` + `draftToRulePayload`)
- Test: `src/lib/journey/rule-draft.test.ts`

- [ ] **Step 1: Escribir el test de round-trip que falla**

Añadir en `src/lib/journey/rule-draft.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ruleToDraft, draftToRulePayload } from "./rule-draft";

const rowConDecision = {
  id: "r1", name: "Ramas", description: null, triggerType: "EVENT", triggerConfig: {},
  conditions: {}, cooldownMinutes: null, priority: 100, isActive: false,
  actions: [
    { type: "ADD_TAG", config: { tag: "nuevo" } },
    { kind: "decision", label: "Por origen", branches: [
      { label: "META", conditions: { field: "adAttribution.network", op: "eq", value: "meta" }, steps: [{ type: "ASSIGN", config: {} }] },
    ], else: [{ type: "NOTIFY", config: {} }] },
  ],
};

describe("rule-draft árbol round-trip", () => {
  it("ruleToDraft → draftToRulePayload preserva el árbol (sin nodeId/branchId)", () => {
    const draft = ruleToDraft(rowConDecision as never);
    const payload = draftToRulePayload(draft);
    expect(payload.actions).toEqual(rowConDecision.actions);
  });

  it("asigna nodeId/branchId estables en el draft", () => {
    const draft = ruleToDraft(rowConDecision as never);
    expect(draft.actions[0].nodeId).toBe("a0");
    expect(draft.actions[1].nodeId).toBe("a1");
  });
});
```

- [ ] **Step 2: Correr para verlo fallar**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts`
Expected: FAIL (el draft actual aplana/pierde el nodo de decisión).

- [ ] **Step 3: Reescribir tipos + ruleToDraft + draftToRulePayload**

En `rule-draft.ts`:

1. Cambiar `RuleRow.actions` y `RulePayload.actions` a `WorkflowNode[]` (importar el tipo):

```ts
import type { WorkflowNode } from "@/lib/validations/rebuild-f1";
```

```ts
// en RuleRow:  actions: WorkflowNode[];
// en RulePayload: actions: WorkflowNode[];
```

2. Reemplazar `ActionDraft` y `RuleDraft.actions` por el modelo de árbol del draft:

```ts
export interface ActionNodeDraft {
  nodeId: string;
  kind?: "action";
  type: string;
  config: Record<string, unknown>;
  delayMinutes?: number;
  autonomyLevel?: string;
}
export interface BranchDraft {
  branchId: string;
  label?: string;
  conditions: Conditions;
  steps: NodeDraft[];
}
export interface DecisionNodeDraft {
  nodeId: string;
  kind: "decision";
  label?: string;
  branches: BranchDraft[];
  else?: NodeDraft[];
}
export type NodeDraft = ActionNodeDraft | DecisionNodeDraft;

export function isDecisionDraft(n: NodeDraft): n is DecisionNodeDraft {
  return n.kind === "decision";
}
```

y en `RuleDraft`: `actions: NodeDraft[];`

3. Reescribir `ruleToDraft` para asignar ids estables recursivamente:

```ts
function nodeToDraft(node: WorkflowNode, path: string): NodeDraft {
  if ((node as { kind?: string }).kind === "decision") {
    const d = node as Extract<WorkflowNode, { kind: "decision" }>;
    return {
      nodeId: path,
      kind: "decision",
      ...(d.label !== undefined ? { label: d.label } : {}),
      branches: d.branches.map((b, bi) => ({
        branchId: `${path}.b${bi}`,
        ...(b.label !== undefined ? { label: b.label } : {}),
        conditions: (b.conditions ?? {}) as Conditions,
        steps: b.steps.map((s, si) => nodeToDraft(s, `${path}.b${bi}.${si}`)),
      })),
      ...(d.else ? { else: d.else.map((s, si) => nodeToDraft(s, `${path}.else.${si}`)) } : {}),
    };
  }
  const a = node as Extract<WorkflowNode, { type: string }>;
  return {
    nodeId: path,
    type: a.type,
    config: (a.config ?? {}) as Record<string, unknown>,
    ...(a.delayMinutes !== undefined ? { delayMinutes: a.delayMinutes } : {}),
    ...(a.autonomyLevel !== undefined ? { autonomyLevel: a.autonomyLevel } : {}),
  };
}
```

> Importante: los nodeId top-level deben quedar `a0`, `a1`, … para no romper el inspector existente (`selectedId.startsWith("a")`). Mantener ese prefijo en el nivel raíz. Ajustar `nodeToDraft` para que la raíz use `a${i}` y los hijos usen el path del padre. Implementar en `ruleToDraft`:

```ts
    actions: (Array.isArray(row.actions) ? row.actions : []).map((n, i) => nodeToDraft(n, `a${i}`)),
```

4. Reescribir `draftToRulePayload` para limpiar nodeId/branchId recursivamente:

```ts
function draftToNode(n: NodeDraft): WorkflowNode {
  if (isDecisionDraft(n)) {
    return {
      kind: "decision",
      ...(n.label !== undefined ? { label: n.label } : {}),
      branches: n.branches.map((b) => ({
        ...(b.label !== undefined ? { label: b.label } : {}),
        conditions: b.conditions,
        steps: b.steps.map(draftToNode),
      })),
      ...(n.else ? { else: n.else.map(draftToNode) } : {}),
    } as WorkflowNode;
  }
  return {
    type: n.type,
    config: n.config,
    ...(n.delayMinutes !== undefined ? { delayMinutes: n.delayMinutes } : {}),
    ...(n.autonomyLevel !== undefined ? { autonomyLevel: n.autonomyLevel } : {}),
  } as WorkflowNode;
}
```

y en `draftToRulePayload`: `actions: draft.actions.map(draftToNode),`.

5. `newRuleDraft()` sigue válido (1 acción `CHANGE_STAGE` con nodeId `a0`).

- [ ] **Step 4: Correr para verlo pasar**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts && npx tsc --noEmit`
Expected: PASS.

> Es esperable que rompan tests/consumidores que asumían `ActionDraft` plano (inspector, hook, draftToFlow). Se arreglan en las tareas 8–12. Si `npx tsc --noEmit` marca esos archivos, continuar (se resuelven en orden).

- [ ] **Step 5: Commit**

```bash
git add src/lib/journey/rule-draft.ts src/lib/journey/rule-draft.test.ts
git commit -m "feat(journey): RuleDraft árbol + round-trip ruleToDraft/draftToRulePayload"
```

---

### Task 8: Ops puras del árbol (acciones + decisiones + ramas)

**Files:**
- Modify: `src/lib/journey/rule-draft.ts` (todas las ops `addAction`/`removeAction`/… + nuevas)
- Test: `src/lib/journey/rule-draft.test.ts`

- [ ] **Step 1: Escribir tests que fallan**

Añadir:

```ts
import { addAction, removeNode, setActionConfig, addDecision, addBranch, removeBranch, setBranchConditions, setBranchLabel } from "./rule-draft";
import { newRuleDraft } from "./rule-draft";

describe("rule-draft ops de árbol", () => {
  it("addAction agrega al nivel raíz", () => {
    const d = addAction(newRuleDraft(), "ADD_TAG");
    expect(d.actions.at(-1)).toMatchObject({ type: "ADD_TAG" });
  });

  it("addDecision agrega un nodo decisión con una rama vacía", () => {
    const d = addDecision(newRuleDraft());
    const dec = d.actions.at(-1) as { kind: string; branches: unknown[] };
    expect(dec.kind).toBe("decision");
    expect(dec.branches).toHaveLength(1);
  });

  it("addBranch agrega rama a una decisión por nodeId", () => {
    let d = addDecision(newRuleDraft());
    const decId = (d.actions.at(-1) as { nodeId: string }).nodeId;
    d = addBranch(d, decId);
    expect((d.actions.at(-1) as { branches: unknown[] }).branches).toHaveLength(2);
  });

  it("setBranchConditions / setBranchLabel mutan la rama correcta", () => {
    let d = addDecision(newRuleDraft());
    const dec = d.actions.at(-1) as { branches: { branchId: string }[] };
    const bid = dec.branches[0].branchId;
    d = setBranchLabel(d, bid, "META");
    d = setBranchConditions(d, bid, { field: "adAttribution.network", op: "eq", value: "meta" } as never);
    const b = (d.actions.at(-1) as { branches: { branchId: string; label?: string; conditions: unknown }[] }).branches[0];
    expect(b.label).toBe("META");
    expect(b.conditions).toMatchObject({ field: "adAttribution.network" });
  });

  it("removeNode elimina un nodo en cualquier nivel y reindexa raíz", () => {
    let d = addAction(newRuleDraft(), "NOTIFY"); // a0 (CHANGE_STAGE), a1 (NOTIFY)
    d = removeNode(d, "a0");
    expect(d.actions).toHaveLength(1);
    expect(d.actions[0].nodeId).toBe("a0"); // reindexado
  });

  it("removeBranch quita una rama; si queda 0, deja la decisión con 1 rama vacía", () => {
    let d = addDecision(newRuleDraft());
    let dec = d.actions.at(-1) as { nodeId: string; branches: { branchId: string }[] };
    d = addBranch(d, dec.nodeId);
    dec = d.actions.at(-1) as { nodeId: string; branches: { branchId: string }[] };
    d = removeBranch(d, dec.branches[0].branchId);
    expect((d.actions.at(-1) as { branches: unknown[] }).branches).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Correr para verlos fallar**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts`
Expected: FAIL (ops nuevas no existen; las viejas asumen plano).

- [ ] **Step 3: Reescribir ops con recursión**

Reemplazar el bloque de ops (`reindex`, `addAction`, `insertAction`, `removeAction`, `reorderAction`, `setActionConfig`, `setActionType`, `setActionDelay`) por versiones que recorren el árbol. Helper central:

```ts
// Reindexa SOLO los nodeId del nivel raíz a a0..an (los hijos conservan el path por branchId).
function reindexRoot(nodes: NodeDraft[]): NodeDraft[] {
  return nodes.map((n, i) => ({ ...n, nodeId: `a${i}` }));
}

// Aplica `fn` al nodo con nodeId == id en cualquier nivel (raíz, steps de rama, else).
function mapNodeById(nodes: NodeDraft[], id: string, fn: (n: NodeDraft) => NodeDraft): NodeDraft[] {
  return nodes.map((n) => {
    if (n.nodeId === id) return fn(n);
    if (isDecisionDraft(n)) {
      return {
        ...n,
        branches: n.branches.map((b) => ({ ...b, steps: mapNodeById(b.steps, id, fn) })),
        ...(n.else ? { else: mapNodeById(n.else, id, fn) } : {}),
      };
    }
    return n;
  });
}

// Aplica `fn` a la rama con branchId == bid en cualquier decisión del árbol.
function mapBranchById(nodes: NodeDraft[], bid: string, fn: (b: BranchDraft) => BranchDraft): NodeDraft[] {
  return nodes.map((n) => {
    if (isDecisionDraft(n)) {
      return {
        ...n,
        branches: n.branches.map((b) => (b.branchId === bid ? fn(b) : { ...b, steps: mapBranchById(b.steps, bid, fn) })),
        ...(n.else ? { else: mapBranchById(n.else, bid, fn) } : {}),
      };
    }
    return n;
  });
}

// Elimina el nodo con nodeId == id en cualquier nivel.
function filterNodeById(nodes: NodeDraft[], id: string): NodeDraft[] {
  return nodes
    .filter((n) => n.nodeId !== id)
    .map((n) =>
      isDecisionDraft(n)
        ? {
            ...n,
            branches: n.branches.map((b) => ({ ...b, steps: filterNodeById(b.steps, id) })),
            ...(n.else ? { else: filterNodeById(n.else, id) } : {}),
          }
        : n,
    );
}
```

Ops públicas (reemplazos + nuevas):

```ts
export function addAction(draft: RuleDraft, type: string): RuleDraft {
  return { ...draft, actions: reindexRoot([...draft.actions, { nodeId: "", type, config: {} }]) };
}

export function insertAction(draft: RuleDraft, type: string, atIndex: number): RuleDraft {
  const i = Math.max(0, Math.min(atIndex, draft.actions.length));
  const next = [...draft.actions];
  next.splice(i, 0, { nodeId: "", type, config: {} });
  return { ...draft, actions: reindexRoot(next) };
}

export function addDecision(draft: RuleDraft): RuleDraft {
  const dec: DecisionNodeDraft = { nodeId: "", kind: "decision", branches: [{ branchId: "", conditions: {} as Conditions, steps: [] }] };
  return { ...draft, actions: reindexRoot([...draft.actions, dec]) };
}

export function removeNode(draft: RuleDraft, nodeId: string): RuleDraft {
  return { ...draft, actions: reindexRoot(filterNodeById(draft.actions, nodeId)) };
}

export function reorderAction(draft: RuleDraft, nodeId: string, dir: "up" | "down"): RuleDraft {
  // Solo reordena en el nivel raíz (drag = reposicionar visual; orden lógico raíz por ↑↓).
  const i = draft.actions.findIndex((a) => a.nodeId === nodeId);
  if (i < 0) return draft;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= draft.actions.length) return draft;
  const next = [...draft.actions];
  [next[i], next[j]] = [next[j], next[i]];
  return { ...draft, actions: reindexRoot(next) };
}

export function setActionConfig(draft: RuleDraft, nodeId: string, patch: Record<string, unknown>): RuleDraft {
  return { ...draft, actions: mapNodeById(draft.actions, nodeId, (n) => (isDecisionDraft(n) ? n : { ...n, config: { ...n.config, ...patch } })) };
}

export function setActionType(draft: RuleDraft, nodeId: string, type: string): RuleDraft {
  return { ...draft, actions: mapNodeById(draft.actions, nodeId, (n) => (isDecisionDraft(n) ? n : { ...n, type, config: {} })) };
}

export function setActionDelay(draft: RuleDraft, nodeId: string, minutes: number): RuleDraft {
  return { ...draft, actions: mapNodeById(draft.actions, nodeId, (n) => (isDecisionDraft(n) ? n : { ...n, delayMinutes: minutes })) };
}

export function setDecisionLabel(draft: RuleDraft, nodeId: string, label: string): RuleDraft {
  return { ...draft, actions: mapNodeById(draft.actions, nodeId, (n) => (isDecisionDraft(n) ? { ...n, label } : n)) };
}

export function addBranch(draft: RuleDraft, decisionNodeId: string): RuleDraft {
  return {
    ...draft,
    actions: mapNodeById(draft.actions, decisionNodeId, (n) =>
      isDecisionDraft(n) ? { ...n, branches: [...n.branches, { branchId: "", conditions: {} as Conditions, steps: [] }] } : n,
    ),
  };
}

export function removeBranch(draft: RuleDraft, branchId: string): RuleDraft {
  const drop = (nodes: NodeDraft[]): NodeDraft[] =>
    nodes.map((n) => {
      if (isDecisionDraft(n)) {
        const kept = n.branches.filter((b) => b.branchId !== branchId);
        const branches = kept.length > 0 ? kept.map((b) => ({ ...b, steps: drop(b.steps) })) : [{ branchId: "", conditions: {} as Conditions, steps: [] }];
        return { ...n, branches, ...(n.else ? { else: drop(n.else) } : {}) };
      }
      return n;
    });
  return { ...draft, actions: rebuildBranchIds(drop(draft.actions)) };
}

export function setBranchConditions(draft: RuleDraft, branchId: string, conditions: Conditions): RuleDraft {
  return { ...draft, actions: mapBranchById(draft.actions, branchId, (b) => ({ ...b, conditions })) };
}

export function setBranchLabel(draft: RuleDraft, branchId: string, label: string): RuleDraft {
  return { ...draft, actions: mapBranchById(draft.actions, branchId, (b) => ({ ...b, label })) };
}

export function addActionToBranch(draft: RuleDraft, branchId: string, type: string): RuleDraft {
  return { ...draft, actions: rebuildBranchIds(mapBranchById(draft.actions, branchId, (b) => ({ ...b, steps: [...b.steps, { nodeId: "", type, config: {} }] }))) };
}
```

Y un re-asignador estable de ids tras mutaciones estructurales (mantiene paths consistentes con `ruleToDraft`):

```ts
function rebuildBranchIds(nodes: NodeDraft[], prefix = ""): NodeDraft[] {
  return nodes.map((n, i) => {
    const path = prefix ? `${prefix}.${i}` : `a${i}`;
    if (isDecisionDraft(n)) {
      return {
        ...n, nodeId: path,
        branches: n.branches.map((b, bi) => ({ ...b, branchId: `${path}.b${bi}`, steps: rebuildBranchIds(b.steps, `${path}.b${bi}`) })),
        ...(n.else ? { else: rebuildBranchIds(n.else, `${path}.else`) } : {}),
      };
    }
    return { ...n, nodeId: path };
  });
}
```

> Reemplazar `reindexRoot` por `rebuildBranchIds` en `addAction`/`insertAction`/`addDecision`/`removeNode`/`reorderAction` para que TODOS los ids (raíz y anidados) queden consistentes con los que produce `ruleToDraft`. (Es decir: usar siempre `rebuildBranchIds(next)` en lugar de `reindexRoot(next)`.) Eliminar `reindexRoot` si queda sin uso.

- [ ] **Step 4: Correr para verlos pasar**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/journey/rule-draft.ts src/lib/journey/rule-draft.test.ts
git commit -m "feat(journey): ops puras del árbol (decisiones, ramas) con ids estables"
```

---

### Task 9: `draftToFlow` proyecta el árbol (rombo + arista por rama)

**Files:**
- Modify: `src/lib/journey/rule-draft.ts` (`draftToFlow`)
- Test: el test de `draftToFlow` existente (en `rule-draft.test.ts`) + casos nuevos

- [ ] **Step 1: Escribir el test que falla**

```ts
import { draftToFlow, ruleToDraft } from "./rule-draft";

it("draftToFlow: una decisión produce un nodo 'decision' y una arista por rama", () => {
  const draft = ruleToDraft({
    id: "r1", name: "x", description: null, triggerType: "EVENT", triggerConfig: {}, conditions: {},
    cooldownMinutes: null, priority: 100, isActive: false,
    actions: [{ kind: "decision", label: "Origen", branches: [
      { label: "META", conditions: {}, steps: [{ type: "ASSIGN", config: {} }] },
      { label: "WEB", conditions: {}, steps: [{ type: "NOTIFY", config: {} }] },
    ] }],
  } as never);
  const flow = draftToFlow(draft);
  expect(flow.nodes.some((n) => n.type === "decision")).toBe(true);
  // 2 ramas → al menos 2 aristas salientes del nodo decisión, etiquetadas
  const decId = flow.nodes.find((n) => n.type === "decision")!.id;
  const out = flow.edges.filter((e) => e.source === decId);
  expect(out.length).toBe(2);
});
```

- [ ] **Step 2: Correr para verlo fallar**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts`
Expected: FAIL (draftToFlow actual no maneja decisión).

- [ ] **Step 3: Reescribir `draftToFlow` recursivo**

Reemplazar `draftToFlow` por una versión que recorre el árbol, colocando trigger/condition al inicio y luego los nodos, con `RFEdge.data.label` para etiquetar ramas. Permitir que `RFEdge` lleve `data` opcional (extender el tipo en `flow-adapter.ts`: `export interface RFEdge { id: string; source: string; target: string; data?: Record<string, unknown> }`).

```ts
export function draftToFlow(draft: RuleDraft): Flow {
  const nodes: RFNode[] = [];
  const edges: RFEdge[] = [];
  let col = 0;
  const place = (id: string, type: string, data: Record<string, unknown>, depth: number) => {
    nodes.push({ id, type, position: { x: col * LANE_W, y: depth * 90 }, data });
    col++;
  };

  place("trigger", "trigger", { triggerType: draft.triggerType, triggerConfig: draft.triggerConfig, label: draft.name }, 0);
  let lastLinear = "trigger";
  if (!conditionsEmpty(draft.conditions)) {
    place("condition", "condition", { conditions: draft.conditions }, 0);
    edges.push({ id: `trigger->condition`, source: "trigger", target: "condition" });
    lastLinear = "condition";
  }

  // Recorre nodos encadenándolos a `parentId`. `firstEdgeLabel` etiqueta SOLO la arista
  // que conecta el primer nodo de la lista (se usa para nombrar la rama de una decisión).
  // Devuelve el id del último nodo emitido (para encadenar al siguiente hermano).
  function emit(list: NodeDraft[], parentId: string, depth: number, firstEdgeLabel?: string): string {
    let prev = parentId;
    list.forEach((n, idx) => {
      const linkLabel = idx === 0 ? firstEdgeLabel : undefined;
      const edge = (target: string): RFEdge => ({
        id: `${prev}->${target}`, source: prev, target,
        ...(linkLabel ? { data: { label: linkLabel } } : {}),
      });
      if (isDecisionDraft(n)) {
        place(n.nodeId, "decision", { label: n.label ?? "Decisión" }, depth);
        edges.push(edge(n.nodeId));
        // Cada rama: UNA arista etiquetada decisión→primer-paso; pasos internos se encadenan dentro.
        n.branches.forEach((b) => {
          if (b.steps.length > 0) emit(b.steps, n.nodeId, depth + 1, b.label ?? "rama");
        });
        if (n.else && n.else.length > 0) emit(n.else, n.nodeId, depth + 1, "por defecto");
        prev = n.nodeId; // tras una decisión, el hermano siguiente cuelga de la decisión
      } else {
        const isStage = n.type === "CHANGE_STAGE";
        place(n.nodeId, isStage ? "stage" : "action", { actionType: n.type, config: n.config, delayMinutes: n.delayMinutes }, depth);
        edges.push(edge(n.nodeId));
        prev = n.nodeId;
      }
    });
    return prev;
  }

  emit(draft.actions, lastLinear, 1);
  return { nodes, edges };
}
```

> Una sola arista por rama: `emit` conecta el primer paso de cada rama a la decisión con la arista etiquetada (`data.label`), y los pasos internos de la rama se encadenan entre sí (sin label). Así el conteo del test (`edges.filter(e => e.source === decId)`) es exactamente el número de ramas (+1 si hay `else`). Auto-layout aproximado; la persistencia de posiciones de i1 lo refina.

- [ ] **Step 4: Correr para verlo pasar**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/journey/rule-draft.ts src/lib/journey/flow-adapter.ts
git commit -m "feat(journey): draftToFlow proyecta decisión como rombo + arista por rama"
```

---

### Task 10: Paleta — ítem "◆ Decisión"

**Files:**
- Modify: `src/components/journey/node-palette.tsx`

- [ ] **Step 1: Leer el componente y su contrato de selección**

Run: leer `src/components/journey/node-palette.tsx` para ver cómo emite la elección (callback `onPick(type)` o similar) y cómo agrupa por `paletteGroups()`.

- [ ] **Step 2: Agregar la opción decisión**

Añadir, fuera de los grupos del catálogo (que son tipos de acción), un ítem fijo "◆ Decisión" que invoque un callback nuevo `onAddDecision` (no es un `workflowActionType`, no toca `NODE_CATALOG`). Si la paleta hoy solo tiene `onPick(type: string)`, extender su prop con `onAddDecision?: () => void` y renderizar el botón al inicio:

```tsx
{onAddDecision && (
  <button className="palette-item" onClick={onAddDecision}>◆ Decisión (bifurca)</button>
)}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: el error pendiente será que el consumidor (journey-map-view) aún no pasa `onAddDecision` — se resuelve en Task 12. Si bloquea, hacer la prop opcional (ya lo es).

- [ ] **Step 4: Commit**

```bash
git add src/components/journey/node-palette.tsx
git commit -m "feat(journey): paleta ofrece nodo de decisión"
```

---

### Task 11: Inspector del nodo de decisión

**Files:**
- Create: `src/components/journey/decision-inspector.tsx`
- Modify: `src/components/journey/rule-inspector-panel.tsx`

- [ ] **Step 1: Crear `DecisionInspector`**

`src/components/journey/decision-inspector.tsx`:

```tsx
"use client";
import type { DecisionNodeDraft, BranchDraft, Conditions } from "@/lib/journey/rule-draft";
import { ConditionTreeEditor } from "@/components/config/condition-tree";
import { parseConditions, buildConditionsTree } from "@/lib/workflows/builder-model";

interface DecisionOps {
  setDecisionLabel: (nodeId: string, label: string) => void;
  addBranch: (decisionNodeId: string) => void;
  removeBranch: (branchId: string) => void;
  setBranchLabel: (branchId: string, label: string) => void;
  setBranchConditions: (branchId: string, c: Conditions) => void;
  addActionToBranch: (branchId: string, type: string) => void;
  removeNode: (nodeId: string) => void;
}

export function DecisionInspector({ decision, ops }: { decision: DecisionNodeDraft; ops: DecisionOps }) {
  return (
    <aside className="journey-inspector">
      <h3 className="label">◆ Decisión</h3>
      <input
        className="form-input"
        placeholder="Nombre (p. ej. Por origen)"
        value={decision.label ?? ""}
        onChange={(e) => ops.setDecisionLabel(decision.nodeId, e.target.value)}
      />
      {decision.branches.map((b: BranchDraft, i) => (
        <div key={b.branchId} className="decision-branch">
          <div className="flex items-center justify-between">
            <input
              className="form-input"
              placeholder={`Rama ${i + 1}`}
              value={b.label ?? ""}
              onChange={(e) => ops.setBranchLabel(b.branchId, e.target.value)}
            />
            <button className="btn-secondary" onClick={() => ops.removeBranch(b.branchId)}>Quitar rama</button>
          </div>
          <ConditionTreeEditor
            tree={parseConditions(b.conditions)}
            onChange={(tree) => ops.setBranchConditions(b.branchId, buildConditionsTree(tree) as Conditions)}
            label="Si cumple…"
          />
          <p className="label" style={{ marginTop: 6 }}>
            {b.steps.length} acción(es) en esta rama — edítalas seleccionando sus nodos en el lienzo.
          </p>
        </div>
      ))}
      <button className="btn-secondary" onClick={() => ops.addBranch(decision.nodeId)}>+ Añadir rama</button>
    </aside>
  );
}
```

> Reusa exactamente `parseConditions`/`buildConditionsTree` de `builder-model.ts` (igual que el inspector actual). La edición de las acciones DENTRO de cada rama se hace seleccionando el nodo-acción en el lienzo (cae en el bloque "Action node" del inspector existente, que ya funciona por `nodeId`).

- [ ] **Step 2: Despachar al `DecisionInspector` desde `rule-inspector-panel.tsx`**

En `RuleInspectorPanel`, antes del bloque "Action node", localizar si el `selectedId` corresponde a un nodo de decisión recorriendo el árbol:

```tsx
import { DecisionInspector } from "./decision-inspector";
import { isDecisionDraft, type NodeDraft, type DecisionNodeDraft } from "@/lib/journey/rule-draft";

function findNode(nodes: NodeDraft[], id: string): NodeDraft | undefined {
  for (const n of nodes) {
    if (n.nodeId === id) return n;
    if (isDecisionDraft(n)) {
      for (const b of n.branches) { const f = findNode(b.steps, id); if (f) return f; }
      if (n.else) { const f = findNode(n.else, id); if (f) return f; }
    }
  }
  return undefined;
}
```

Reemplazar la línea `const action = selectedId?.startsWith("a") ? draft.actions.find(...)` por una que busque en todo el árbol:

```tsx
const selected = selectedId ? findNode(draft.actions, selectedId) : undefined;
const decision = selected && isDecisionDraft(selected) ? (selected as DecisionNodeDraft) : undefined;
const action = selected && !isDecisionDraft(selected) ? selected : undefined;
```

Añadir, antes del bloque `if (action) {`:

```tsx
if (decision) {
  return <DecisionInspector decision={decision} ops={ops} />;
}
```

Extender la interfaz `Ops` del inspector con los métodos nuevos (`setDecisionLabel`, `addBranch`, `removeBranch`, `setBranchLabel`, `setBranchConditions`, `addActionToBranch`, `removeNode`). En el bloque "Action node", cambiar `ops.removeAction(action.nodeId)` por `ops.removeNode(action.nodeId)`.

En el bloque "Rule metadata", añadir junto a "+ Añadir acción": `<button className="btn-secondary" onClick={() => ops.addDecision()}>+ Añadir decisión</button>` (y agregar `addDecision: () => void` a `Ops`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: faltará que el hook exponga los ops nuevos (Task 12). Continuar.

- [ ] **Step 4: Commit**

```bash
git add src/components/journey/decision-inspector.tsx src/components/journey/rule-inspector-panel.tsx
git commit -m "feat(journey): inspector de nodo de decisión (ramas + condiciones reusando ConditionTreeEditor)"
```

---

### Task 12: Wiring — hook + vista (render rombo, selección, guardar)

**Files:**
- Modify: `src/components/journey/use-rule-draft.ts`
- Modify: `src/components/journey/journey-map-view.tsx`

- [ ] **Step 1: Exponer los ops nuevos en el hook**

Leer `use-rule-draft.ts`. Agregar al objeto `ops` que retorna, los wrappers que faltan llamando a las funciones puras de `rule-draft.ts`:

```ts
import {
  addDecision, removeNode, setDecisionLabel, addBranch, removeBranch,
  setBranchLabel, setBranchConditions, addActionToBranch,
} from "@/lib/journey/rule-draft";
```

```ts
  addDecision: () => setDraft((d) => addDecision(d)),
  removeNode: (nodeId: string) => setDraft((d) => removeNode(d, nodeId)),
  setDecisionLabel: (nodeId: string, label: string) => setDraft((d) => setDecisionLabel(d, nodeId, label)),
  addBranch: (decisionNodeId: string) => setDraft((d) => addBranch(d, decisionNodeId)),
  removeBranch: (branchId: string) => setDraft((d) => removeBranch(d, branchId)),
  setBranchLabel: (branchId: string, label: string) => setDraft((d) => setBranchLabel(d, branchId, label)),
  setBranchConditions: (branchId: string, c) => setDraft((d) => setBranchConditions(d, branchId, c)),
  addActionToBranch: (branchId: string, type: string) => setDraft((d) => addActionToBranch(d, branchId, type)),
```

(Adaptar al patrón real del hook — sea `setDraft(fn)` o reducer.) Mantener `removeAction` como alias de `removeNode` si algún consumidor aún lo llama, o actualizar la llamada.

- [ ] **Step 2: Registrar el tipo de nodo `decision` en React Flow + render del rombo**

En `journey-map-view.tsx`, agregar un nodo custom `DecisionNode` al mapa `nodeTypes` de React Flow (rombo: un `div` rotado 45° o con `clip-path`), mostrando `data.label`. Asegurar que las aristas con `data.label` rendericen el label (React Flow muestra `edge.label`; mapear `data.label`→`label` al construir las edges para el lienzo, o usar `InsertEdge`/edge custom existente de i3 con label).

Asegurar que la paleta recibe `onAddDecision={ops.addDecision}` y que el click en un nodo `decision` setea `selectedId = node.id` (igual que cualquier nodo → ya debería funcionar con el handler de selección existente).

- [ ] **Step 3: Verificación de build + typecheck completo**

Run: `npx tsc --noEmit && npm run build`
Expected: build verde.

- [ ] **Step 4: Suite completa**

Run: `npx vitest run`
Expected: todo verde (la suite previa ~353 + los nuevos del árbol).

- [ ] **Step 5: Commit**

```bash
git add src/components/journey/use-rule-draft.ts src/components/journey/journey-map-view.tsx
git commit -m "feat(journey): wiring del canvas — rombo de decisión, ramas y guardado"
```

---

## Verificación final (antes de merge)

- [ ] `npx vitest run` — toda la suite verde.
- [ ] `npx tsc --noEmit` — sin errores.
- [ ] `npm run build` — build verde.
- [ ] **Smoke en vivo Playwright (pedir autorización a Luis):** levantar dev, login ADMIN → `/journey` vista Dirigida → "+ Crear regla" → "+ Añadir decisión" → 2 ramas (META / WEB) con sus condiciones → acción en cada rama → Guardar (regla inactiva) → verificar en BD vía MCP Supabase que `actions` tiene la forma de árbol `{kind:"decision",branches:[...]}` → borrar la regla de prueba.
  - **GOTCHA pooler (i3):** si aparece `EMAXCONNSESSION: max clients (pool_size 15)`, hay un dev server huérfano; matar por PID del puerto con `taskkill //PID <pid>` (NO `node` masivo — mata MCP/Claude). Ver `feedback_windows_node_orphans`.
- [ ] Review final (Opus) de todo el diff.
- [ ] ff-push de `feat/crm-journey-ramas` a `main` (autor `Propyte-Luis`) → auto-deploy Hostinger.

## Notas / caveats

- **dedupeKey por `path`:** editar el árbol de una regla con acciones en vuelo puede recalcular rutas → una acción podría re-encolarse bajo un path nuevo. Mismo caveat que cadencias (sub-B). Si se vuelve problema, señalar en UI cuando la regla tiene ejecuciones recientes en `ActionQueue`.
- **Los 4 lugares de la verdad** del shape de acciones (recordatorio del spec, lección sub-A): zod (`rebuild-f1.ts`), motor (`engine.ts`+`scheduler.ts` vía `walkNodes`), canvas (`rule-draft.ts`+`draftToFlow`+inspector), catálogo (`node-catalog.ts`). El nodo de decisión NO es un `workflowActionType` → no entra al catálogo; vive como concepto del árbol/canvas.
- **Fuera de alcance** (futuro, a pedido de Luis): reunión/merge de ramas, anidar cadencias, condiciones por-paso de cadencia, split A/B aleatorio.
