# Journey Canvas i3 — Paleta de nodos + pulido · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar la UX de edición de la vista Dirigida del journey: paleta de nodos para añadir/insertar acciones, campos amables en el inspector para los tipos comunes, y pulido visual de los nodos.

**Architecture:** Aditivo sobre el modelo draft-object de i2 (write-back sin cambios: `draftToRulePayload`→`PUT/POST /api/admin/automation/rules`). Una **única fuente** nueva, `node-catalog.ts` (puro), define por tipo de acción su categoría, label amable y campos del inspector; la consumen lienzo, paleta e inspector → sin divergencia. Una sola op pura nueva (`insertAction`). Sin endpoints, sin migración, sin tocar el motor.

**Tech Stack:** Next.js 14, TypeScript, React, `@xyflow/react` v12 (aristas custom vía `EdgeLabelRenderer`), Vitest.

**Worktree:** `.claude/worktrees/crm-journey-canvas-i3`, rama `feat/crm-journey-canvas-i3` (base `origin/main`=`1081424`=i2). Verificar `git branch --show-current` antes de cada commit.

**Setup previo (una vez):** el worktree necesita `node_modules`. Correr `npm install` y luego `npx prisma generate` (normal, NO `--no-engine`) antes del primer typecheck/build. Repetir `npx prisma generate` tras cualquier `npm install` posterior.

---

## File Structure

- **Modify** `src/lib/validations/rebuild-f1.ts` — exportar `TRIGGER_TYPES` compartido (saldar deuda i2).
- **Create** `src/lib/journey/node-catalog.ts` — catálogo único: metadatos + fieldDefs + helpers.
- **Create** `src/lib/journey/node-catalog.test.ts` — tests del catálogo.
- **Modify** `src/lib/journey/rule-draft.ts` — `insertAction(draft, type, atIndex)`.
- **Modify** `src/lib/journey/rule-draft.test.ts` — tests de `insertAction`.
- **Create** `src/components/journey/node-palette.tsx` — picker agrupado.
- **Create** `src/components/journey/insert-edge.tsx` — arista custom con "⊕".
- **Modify** `src/components/journey/rule-inspector-panel.tsx` — campos amables del catálogo + JSON fallback + fix JsonField re-sync + campos de trigger.
- **Modify** `src/components/journey/journey-map-view.tsx` — labels/colores del catálogo, paleta, aristas de inserción.

---

## Task 1: `TRIGGER_TYPES` compartido (deuda i2)

**Files:**
- Modify: `src/lib/validations/rebuild-f1.ts`
- Modify: `src/app/api/admin/automation/rules/route.ts`

- [ ] **Step 1: Exportar la constante en rebuild-f1.ts**

Añadir (cerca de `workflowActionTypes`):
```ts
export const TRIGGER_TYPES = [
  "EVENT", "TIME", "BEHAVIORAL", "INACTIVITY", "STAGE_CHANGE", "SLA_BREACH", "SCORE_THRESHOLD",
] as const;
```

- [ ] **Step 2: Usarla en la API en vez del literal local**

En `src/app/api/admin/automation/rules/route.ts`: borrar el `const TRIGGER_TYPES = [...] as const;` local e importar el compartido:
```ts
import { conditionsDslSchema, workflowActionTypes, TRIGGER_TYPES } from "@/lib/validations/rebuild-f1";
```
(El uso `z.enum(TRIGGER_TYPES)` queda igual.)

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (sin errores nuevos).
```bash
git add src/lib/validations/rebuild-f1.ts src/app/api/admin/automation/rules/route.ts
git commit -m "refactor(journey): TRIGGER_TYPES a constante compartida (deuda i2)"
```

---

## Task 2: Catálogo de nodos `node-catalog.ts`

**Files:**
- Create: `src/lib/journey/node-catalog.ts`
- Test: `src/lib/journey/node-catalog.test.ts`

Define metadatos por `WorkflowActionType` (de `workflowActionTypes`). Los `fields` derivan del contrato real en `actions.ts` (ya verificado: CREATE_TASK=subject/description/dueInMinutes; SEND_WHATSAPP=template/body; NOTIFY=title/message/type; ASSIGN/REASSIGN=reason; ADD_TAG=tag; CHANGE_STAGE=toStage[pipeline]; SET_LIFECYCLE=toStage[lifecycle]+allowBackward; ESCALATE=reason; UPDATE_FIELD=field+value). MAKE_CALL/ENROLL_PLAN/AI_*/WEBHOOK quedan sin `fields` → inspector usa JSON.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/journey/node-catalog.test.ts
import { describe, it, expect } from "vitest";
import { workflowActionTypes } from "@/lib/validations/rebuild-f1";
import { NODE_CATALOG, paletteGroups, metaFor, labelFor, summaryFor, fieldDefsFor } from "./node-catalog";

describe("node-catalog", () => {
  it("cubre todos los workflowActionTypes con categoría y label", () => {
    for (const t of workflowActionTypes) {
      const m = metaFor(t);
      expect(m, `falta meta para ${t}`).toBeTruthy();
      expect(m!.category).toBeTruthy();
      expect(m!.label.length).toBeGreaterThan(0);
    }
    expect(NODE_CATALOG.length).toBe(workflowActionTypes.length);
  });

  it("los tipos comunes tienen fields con configKey no vacío", () => {
    for (const t of ["SEND_WHATSAPP", "CREATE_TASK", "ADD_TAG", "CHANGE_STAGE", "SET_LIFECYCLE", "NOTIFY", "ASSIGN", "UPDATE_FIELD", "ESCALATE"]) {
      const defs = fieldDefsFor(t);
      expect(defs.length, `sin fields ${t}`).toBeGreaterThan(0);
      for (const d of defs) expect(d.configKey.length).toBeGreaterThan(0);
    }
  });

  it("CHANGE_STAGE usa etapas de pipeline; SET_LIFECYCLE usa lifecycle", () => {
    const cs = fieldDefsFor("CHANGE_STAGE")[0];
    expect(cs.options?.some((o) => o.value === "NEW_LEAD")).toBe(true);
    const sl = fieldDefsFor("SET_LIFECYCLE")[0];
    expect(sl.options?.some((o) => o.value === "MQL")).toBe(true);
  });

  it("labelFor cae al enum si no hay meta; summaryFor arma 'label · valor'", () => {
    expect(labelFor("SEND_WHATSAPP")).toContain("WhatsApp");
    expect(labelFor("DESCONOCIDO")).toBe("DESCONOCIDO");
    expect(summaryFor("SEND_WHATSAPP", { template: "bienvenida" })).toBe("💬 WhatsApp · bienvenida");
    expect(summaryFor("SEND_WHATSAPP", {})).toBe("💬 WhatsApp");
  });

  it("paletteGroups agrupa por categoría sin perder tipos", () => {
    const total = paletteGroups().reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(workflowActionTypes.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/journey/node-catalog.test.ts` → FAIL (módulo no existe).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/journey/node-catalog.ts
// Catálogo único de tipos de nodo (C.2-i3). Fuente de labels/categorías/campos
// para lienzo + paleta + inspector. Puro: sin React.
import { workflowActionTypes } from "@/lib/validations/rebuild-f1";
import { PIPELINE_STAGES, LIFECYCLE_ORDER, LIFECYCLE_LABELS } from "@/lib/constants";

export type NodeCategory = "Comunicación" | "Pipeline" | "Asignación" | "IA" | "Otros";
export type FieldKind = "text" | "number" | "textarea" | "select" | "checkbox";

export interface FieldDef {
  configKey: string;
  label: string;
  kind: FieldKind;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface NodeTypeMeta {
  type: string;
  category: NodeCategory;
  label: string;
  summaryKey?: string;
  fields?: FieldDef[];
}

const STAGE_OPTS = PIPELINE_STAGES.map((s) => ({ value: s.code, label: s.label }));
const LIFECYCLE_OPTS = LIFECYCLE_ORDER.map((s) => ({ value: s, label: LIFECYCLE_LABELS[s] ?? s }));
const UPDATE_FIELD_OPTS = ["temperature", "contactStatus", "urgency", "contactType", "leadSource"]
  .map((f) => ({ value: f, label: f }));

export const NODE_CATALOG: NodeTypeMeta[] = [
  { type: "SEND_WHATSAPP", category: "Comunicación", label: "💬 WhatsApp", summaryKey: "template",
    fields: [
      { configKey: "template", label: "Plantilla", kind: "text", placeholder: "bienvenida_es" },
      { configKey: "body", label: "Mensaje (si no hay plantilla)", kind: "textarea" },
    ] },
  { type: "SEND_EMAIL", category: "Comunicación", label: "✉️ Email", summaryKey: "template",
    fields: [
      { configKey: "template", label: "Plantilla", kind: "text" },
      { configKey: "subject", label: "Asunto", kind: "text" },
      { configKey: "body", label: "Cuerpo", kind: "textarea" },
    ] },
  { type: "MAKE_CALL", category: "Comunicación", label: "📞 Llamada" },
  { type: "NOTIFY", category: "Comunicación", label: "🔔 Notificar", summaryKey: "title",
    fields: [
      { configKey: "title", label: "Título", kind: "text" },
      { configKey: "message", label: "Mensaje", kind: "textarea" },
      { configKey: "type", label: "Tipo", kind: "text", placeholder: "workflow" },
    ] },
  { type: "CHANGE_STAGE", category: "Pipeline", label: "🎯 Cambiar etapa", summaryKey: "toStage",
    fields: [{ configKey: "toStage", label: "Etapa del pipeline", kind: "select", options: STAGE_OPTS }] },
  { type: "SET_LIFECYCLE", category: "Pipeline", label: "♻️ Ciclo de vida", summaryKey: "toStage",
    fields: [
      { configKey: "toStage", label: "Etapa de ciclo de vida", kind: "select", options: LIFECYCLE_OPTS },
      { configKey: "allowBackward", label: "Permitir retroceso", kind: "checkbox" },
    ] },
  { type: "ADD_TAG", category: "Pipeline", label: "🏷️ Tag", summaryKey: "tag",
    fields: [{ configKey: "tag", label: "Etiqueta", kind: "text" }] },
  { type: "UPDATE_FIELD", category: "Pipeline", label: "✎ Campo",
    fields: [
      { configKey: "field", label: "Campo", kind: "select", options: UPDATE_FIELD_OPTS },
      { configKey: "value", label: "Valor", kind: "text" },
    ] },
  { type: "ASSIGN", category: "Asignación", label: "👤 Asignar",
    fields: [{ configKey: "reason", label: "Motivo", kind: "text" }] },
  { type: "REASSIGN", category: "Asignación", label: "👤 Reasignar",
    fields: [{ configKey: "reason", label: "Motivo", kind: "text" }] },
  { type: "ESCALATE", category: "Asignación", label: "⚠️ Escalar",
    fields: [{ configKey: "reason", label: "Motivo", kind: "text" }] },
  { type: "AI_DRAFT", category: "IA", label: "🤖 Borrador IA" },
  { type: "AI_REPLY", category: "IA", label: "🤖 Respuesta IA" },
  { type: "AI_CALL_SUMMARY", category: "IA", label: "🤖 Resumen llamada" },
  { type: "CREATE_TASK", category: "Otros", label: "📋 Tarea", summaryKey: "subject",
    fields: [
      { configKey: "subject", label: "Asunto", kind: "text" },
      { configKey: "description", label: "Descripción", kind: "textarea" },
      { configKey: "dueInMinutes", label: "Vence en (min)", kind: "number", placeholder: "1440" },
    ] },
  { type: "ENROLL_PLAN", category: "Otros", label: "⟳ Cadencia" },
  { type: "WEBHOOK", category: "Otros", label: "🔗 Webhook" },
];

const BY_TYPE = new Map(NODE_CATALOG.map((m) => [m.type, m]));
const CATEGORY_ORDER: NodeCategory[] = ["Comunicación", "Pipeline", "Asignación", "IA", "Otros"];

export function metaFor(type: string): NodeTypeMeta | undefined {
  return BY_TYPE.get(type);
}
export function labelFor(type: string): string {
  return BY_TYPE.get(type)?.label ?? type;
}
export function fieldDefsFor(type: string): FieldDef[] {
  return BY_TYPE.get(type)?.fields ?? [];
}
export function summaryFor(type: string, config: Record<string, unknown>): string {
  const m = BY_TYPE.get(type);
  const label = m?.label ?? type;
  const k = m?.summaryKey;
  const v = k ? config?.[k] : undefined;
  return v !== undefined && v !== null && String(v) !== "" ? `${label} · ${String(v)}` : label;
}
export function paletteGroups(): { category: NodeCategory; items: NodeTypeMeta[] }[] {
  return CATEGORY_ORDER
    .map((category) => ({ category, items: NODE_CATALOG.filter((m) => m.category === category) }))
    .filter((g) => g.items.length > 0);
}

// Campos amables del nodo trigger por triggerType común (resto → JSON en el inspector).
export const TRIGGER_FIELDS: Record<string, FieldDef[]> = {
  EVENT: [{ configKey: "eventType", label: "Evento", kind: "text", placeholder: "lead.captured" }],
  STAGE_CHANGE: [{ configKey: "toStage", label: "Cambia a etapa", kind: "select", options: STAGE_OPTS }],
};
export function triggerFieldsFor(triggerType: string): FieldDef[] {
  return TRIGGER_FIELDS[triggerType] ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/journey/node-catalog.test.ts` → PASS (6 tests). (Si falla por `workflowActionTypes` con un tipo no listado en NODE_CATALOG, añadir su entrada — el catálogo DEBE cubrir exactamente la lista zod.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/journey/node-catalog.ts src/lib/journey/node-catalog.test.ts
git commit -m "feat(journey): catálogo único de nodos (categoría/label/campos) (i3)"
```

---

## Task 3: Op pura `insertAction`

**Files:**
- Modify: `src/lib/journey/rule-draft.ts`
- Test: `src/lib/journey/rule-draft.test.ts`

`addAction` de i2 = append. `insertAction(draft, type, atIndex)` inserta en posición y reindexa.

- [ ] **Step 1: Write the failing test**

```ts
// añadir a src/lib/journey/rule-draft.test.ts
import { insertAction } from "./rule-draft";

describe("insertAction", () => {
  const base = ruleToDraft(ROW); // 3 acciones: SEND_WHATSAPP, ASSIGN, CHANGE_STAGE

  it("inserta en el medio y reindexa nodeIds", () => {
    const d = insertAction(base, "NOTIFY", 1);
    expect(d.actions.map((a) => a.type)).toEqual(["SEND_WHATSAPP", "NOTIFY", "ASSIGN", "CHANGE_STAGE"]);
    expect(d.actions.map((a) => a.nodeId)).toEqual(["a0", "a1", "a2", "a3"]);
    expect(d.actions[1].config).toEqual({});
    expect(base.actions.length).toBe(3); // inmutable
  });

  it("atIndex=0 inserta al inicio; atIndex>=length inserta al final (clamp)", () => {
    expect(insertAction(base, "ADD_TAG", 0).actions[0].type).toBe("ADD_TAG");
    expect(insertAction(base, "ADD_TAG", 99).actions.at(-1)!.type).toBe("ADD_TAG");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts` → FAIL (`insertAction` no existe).

- [ ] **Step 3: Write minimal implementation**

Añadir a `src/lib/journey/rule-draft.ts` (junto a `addAction`; reusa el `reindex` privado existente):
```ts
export function insertAction(draft: RuleDraft, type: string, atIndex: number): RuleDraft {
  const i = Math.max(0, Math.min(atIndex, draft.actions.length));
  const next = [...draft.actions];
  next.splice(i, 0, { nodeId: "", type, config: {} });
  return { ...draft, actions: reindex(next) };
}
```
(Opcional DRY: `addAction` puede delegar `return insertAction(draft, type, draft.actions.length);` — hacerlo solo si no rompe sus tests.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/journey/rule-draft.test.ts` → PASS (todos los previos + 2 nuevos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/journey/rule-draft.ts src/lib/journey/rule-draft.test.ts
git commit -m "feat(journey): insertAction op pura con clamp + reindex (i3)"
```

---

## Task 4: Componente `node-palette.tsx`

**Files:**
- Create: `src/components/journey/node-palette.tsx`

Popover con los tipos agrupados por categoría (de `paletteGroups()`). Sin estado propio; emite el tipo elegido.

- [ ] **Step 1: Escribir el componente**

```tsx
// src/components/journey/node-palette.tsx
"use client";
import { paletteGroups } from "@/lib/journey/node-catalog";

export function NodePalette({ onPick, onClose }: { onPick: (type: string) => void; onClose: () => void }) {
  return (
    <div className="absolute z-20 mt-1 w-64 rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      role="menu" onMouseLeave={onClose}>
      {paletteGroups().map((g) => (
        <div key={g.category} className="mb-2 last:mb-0">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{g.category}</p>
          <div className="grid grid-cols-1 gap-0.5">
            {g.items.map((m) => (
              <button key={m.type} type="button" role="menuitem"
                onClick={() => { onPick(m.type); onClose(); }}
                className="rounded px-2 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">
                {m.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (sin errores en el archivo nuevo).

- [ ] **Step 3: Commit**

```bash
git add src/components/journey/node-palette.tsx
git commit -m "feat(journey): NodePalette picker agrupado por categoría (i3)"
```

---

## Task 5: Inspector con campos amables

**Files:**
- Modify: `src/components/journey/rule-inspector-panel.tsx`

Leer primero el archivo actual (i2). Cambios:
1. Para una acción seleccionada: si `fieldDefsFor(action.type).length > 0`, renderizar los campos tipados (en vez del select de etapa hardcodeado de i2 + JSON). Si no, el `JsonField` actual. Mantener el selector de tipo de acción (`workflowActionTypes`), ↑↓, Borrar, y el campo Retraso.
2. Disclosure "Ver JSON" (un `<details>`) que SIEMPRE muestra el `JsonField` del config, incluso para tipos con campos amables (escape hatch).
3. Nodo trigger: si `triggerFieldsFor(draft.triggerType).length > 0`, campos tipados; si no, el `JsonField` de triggerConfig.
4. **Fix JsonField re-sync**: el `JsonField` debe reflejar cambios externos del `value`. Cambiar su `key` para que dependa del contenido entrante, o sincronizar con `useEffect`. Implementación elegida: el padre pasa `key={`${action.nodeId}:${JSON.stringify(action.config)}`}` al JsonField del config — así, al editar por un campo amable (que muta config), el JsonField se remonta con el JSON nuevo. (Igual para trigger: `key={`trigger:${JSON.stringify(draft.triggerConfig)}`}`.)

- [ ] **Step 1: Implementar un renderer de FieldDef + reescribir las ramas del inspector**

Añadir un sub-componente que renderiza un `FieldDef` leyendo/escribiendo `config[configKey]`:
```tsx
import { fieldDefsFor, triggerFieldsFor, type FieldDef } from "@/lib/journey/node-catalog";

function FriendlyField({ def, config, onChange }: { def: FieldDef; config: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }) {
  const raw = config[def.configKey];
  if (def.kind === "checkbox") {
    return (
      <label className="label flex items-center gap-2">
        <input type="checkbox" checked={raw === true} onChange={(e) => onChange({ [def.configKey]: e.target.checked })} />
        {def.label}
      </label>
    );
  }
  if (def.kind === "select") {
    return (
      <div>
        <label className="label">{def.label}</label>
        <select className="form-input" value={String(raw ?? "")} onChange={(e) => onChange({ [def.configKey]: e.target.value })}>
          <option value="">—</option>
          {def.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }
  if (def.kind === "textarea") {
    return (
      <div>
        <label className="label">{def.label}</label>
        <textarea className="form-input" rows={3} value={String(raw ?? "")} placeholder={def.placeholder}
          onChange={(e) => onChange({ [def.configKey]: e.target.value })} />
      </div>
    );
  }
  // text | number
  return (
    <div>
      <label className="label">{def.label}</label>
      <input className="form-input" type={def.kind === "number" ? "number" : "text"} value={String(raw ?? "")} placeholder={def.placeholder}
        onChange={(e) => onChange({ [def.configKey]: def.kind === "number" ? Number(e.target.value) : e.target.value })} />
    </div>
  );
}
```

En la rama de acción del panel, reemplazar el bloque i2 (select de etapa + JsonField directo) por:
```tsx
{(() => {
  const defs = fieldDefsFor(action.type);
  return defs.length > 0 ? (
    <>
      {defs.map((d) => (
        <FriendlyField key={d.configKey} def={d} config={action.config}
          onChange={(patch) => ops.setActionConfig(action.nodeId, patch)} />
      ))}
      <details className="mt-2">
        <summary className="label cursor-pointer">Ver JSON</summary>
        <JsonField key={`${action.nodeId}:${JSON.stringify(action.config)}`} label="config" value={action.config}
          onChange={(v) => ops.setActionConfig(action.nodeId, v)} />
      </details>
    </>
  ) : (
    <JsonField key={`${action.nodeId}:${JSON.stringify(action.config)}`} label="config" value={action.config}
      onChange={(v) => ops.setActionConfig(action.nodeId, v)} />
  );
})()}
```
(El `<select>` de etapa hardcodeado de i2 para CHANGE_STAGE se ELIMINA — ahora lo cubre el fieldDef `toStage` con opciones de pipeline. El campo Retraso y los botones ↑↓/Borrar quedan igual que i2.)

Para el trigger, reemplazar el `JsonField` directo por:
```tsx
{(() => {
  const defs = triggerFieldsFor(draft.triggerType);
  return defs.length > 0 ? (
    <>
      {defs.map((d) => (
        <FriendlyField key={d.configKey} def={d} config={draft.triggerConfig}
          onChange={(patch) => ops.setTrigger({ triggerType: draft.triggerType, triggerConfig: { ...draft.triggerConfig, ...patch } })} />
      ))}
      <details className="mt-2"><summary className="label cursor-pointer">Ver JSON</summary>
        <JsonField key={`trigger:${JSON.stringify(draft.triggerConfig)}`} label="triggerConfig" value={draft.triggerConfig}
          onChange={(v) => ops.setTrigger({ triggerType: draft.triggerType, triggerConfig: v })} />
      </details>
    </>
  ) : (
    <JsonField key={`trigger:${JSON.stringify(draft.triggerConfig)}`} label="triggerConfig" value={draft.triggerConfig}
      onChange={(v) => ops.setTrigger({ triggerType: draft.triggerType, triggerConfig: v })} />
  );
})()}
```
Importar `TRIGGER_TYPES` desde `@/lib/validations/rebuild-f1` (en vez del literal local de i2). Quitar el import de `LIFECYCLE_ORDER`/`LIFECYCLE_LABELS` si ya no se usan tras quitar el select hardcodeado.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build` → verde. (Si Prisma flood: `npx prisma generate` normal y reintentar.)

- [ ] **Step 3: Commit**

```bash
git add src/components/journey/rule-inspector-panel.tsx
git commit -m "feat(journey): inspector con campos amables del catálogo + JSON fallback + re-sync (i3)"
```

---

## Task 6: Arista de inserción + integración en la vista

**Files:**
- Create: `src/components/journey/insert-edge.tsx`
- Modify: `src/components/journey/journey-map-view.tsx`

Leer `journey-map-view.tsx` (i2) completo primero. La cadena en edición tiene aristas `trigger->condition`/`condition->a0`/`a{i}->a{i+1}`. El "⊕" de una arista inserta una acción ANTES del nodo destino de esa arista: si el target es `a{k}` → `insertAt = k`; si el target es `condition` (no es acción) → no se inserta acción ahí (omitir ⊕ en esa arista). Derivar `insertAt` del **target**: si `target` matchea `a{n}`, `insertAt = n`; el último "⊕" para añadir al final se cubre con el botón "Añadir" de la toolbar.

- [ ] **Step 1: Crear la arista custom**

```tsx
// src/components/journey/insert-edge.tsx
"use client";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

// data.onInsert: () => void  (lo inyecta la vista por arista)
export function InsertEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const onInsert = (data as { onInsert?: () => void } | undefined)?.onInsert;
  return (
    <>
      <BaseEdge id={id} path={path} />
      {onInsert && (
        <EdgeLabelRenderer>
          <button type="button"
            style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: "all" }}
            className="rounded-full border border-neutral-300 bg-white px-1.5 text-xs leading-none text-neutral-500 shadow-sm hover:bg-neutral-100"
            onClick={(e) => { e.stopPropagation(); onInsert(); }} aria-label="Insertar acción aquí">⊕</button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
```

- [ ] **Step 2: Integrar en `journey-map-view.tsx`**

Cambios (sobre el archivo i2):
1. Imports: `import { labelFor, summaryFor } from "@/lib/journey/node-catalog";` `import { STAGE_COLORS, STAGE_LABELS } from "@/lib/constants";` `import { NodePalette } from "./node-palette";` `import { InsertEdge } from "./insert-edge";`
2. `nodeLabel(type, data)`: para acciones usar `summaryFor(String(data.actionType), (data.config ?? {}) as Record<string,unknown>)`; para `stage` (CHANGE_STAGE) usar `STAGE_LABELS[toStage] ?? toStage`; trigger igual que i2 (label = name).
3. `nodeStyle` del nodo `stage`: color `STAGE_COLORS[String((data.config as any)?.toStage)] ?? "#6B7280"` (en vez de LIFECYCLE_COLORS — CHANGE_STAGE es etapa de pipeline).
4. Estado paleta: `const [paletteAt, setPaletteAt] = useState<number | null>(null);` (índice de inserción; `null` = cerrada). Botón "Añadir" en la toolbar de edición → `setPaletteAt(draft.actions.length)`. Render `<NodePalette onPick={(t)=>{ ops insert at paletteAt ; setPaletteAt(null);}} onClose={()=>setPaletteAt(null)} />` posicionado bajo el botón. Para insertar se usa una nueva acción del hook: añadir `insertAction` al objeto `ops` del hook **o** llamar directo: extender `use-rule-draft.ts` `ops` con `insertAction: (type, at) => setDraft(d=>d?insertAction(d,type,at):d)` (importar `insertAction`).
5. Aristas de inserción SOLO en edición: al construir el flow en edición, mapear cada edge cuyo `target` matchee `^a(\d+)$` a `{ ...edge, type: "insert", data: { onInsert: () => setPaletteAt(n) } }`. Registrar `edgeTypes={{ insert: InsertEdge }}` en `<ReactFlow>`. (Las aristas en modo read-only quedan default, sin tipo.)
6. Cuando se elige tipo en la paleta: `ops.insertAction(type, paletteAt)` (o `addAction` si `paletteAt===length`).

> **Nota implementer:** extender el hook `use-rule-draft.ts` `ops` con `insertAction` (importar de rule-draft). Es coherente con el patrón de i2 (las ops del hook envuelven las puras). Verificar que `EdgeProps`/`edgeTypes` de `@xyflow/react` v12 tipan `data` como `Record<string,unknown>|undefined` — castear `data` como en el componente.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build` → verde.

- [ ] **Step 4: Commit**

```bash
git add src/components/journey/insert-edge.tsx src/components/journey/journey-map-view.tsx src/components/journey/use-rule-draft.ts
git commit -m "feat(journey): paleta + aristas de inserción + pulido de nodos (i3)"
```

---

## Task 7: Verificación end-to-end

**Files:** ninguno.

- [ ] **Step 1: Suite completa** — Run: `npx vitest run` → todos verdes (i2 + nuevos de catálogo e insertAction).
- [ ] **Step 2: Build** — Run: `npm run build` → exit 0.
- [ ] **Step 3: Smoke Playwright** (autorizado; regla inactiva de prueba; **borrar al final**): login ADMIN → `/journey` → Dirigida → "+ Crear regla" → abrir la paleta desde "Añadir", insertar p.ej. 💬 WhatsApp → seleccionarla → editar con campos amables (plantilla) → clicar un "⊕" entre nodos e insertar otra acción → fijar etapa (CHANGE_STAGE con opciones de pipeline) → poner nombre → Guardar → verificar en BD vía MCP que `actions` refleja el orden+config → borrar la regla de prueba.
- [ ] **Step 4: Commit final** si hubo ajustes.

---

## Notas de cierre (no son tasks)
- Sin migración → sin gate de infra.
- Al cerrar: review holístico, ff-push a `main` (autor Propyte-Luis), auto-deploy; actualizar `project_propyte_crm.md` changelog + `Pendientes_Tracker.md`.
- **Siguiente:** sub-proyecto de **ramas** (decisión de motor: multi-regla vs cambio de executor), luego D (SLA por segmento) / E (email+llamada en vivo) / F (métricas por nodo).
