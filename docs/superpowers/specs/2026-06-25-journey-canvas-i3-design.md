# C.2-i3 — Paleta de nodos + pulido del canvas editable

**Fecha:** 2026-06-25
**Sub-proyecto:** Fase 3 · C (canvas journey) · C.2 (editable) · incremento **i3**
**Rama:** `feat/crm-journey-canvas-i3` (worktree, base `origin/main`=`1081424`=i2)
**Predecesores:** C.1 (read-only), C.2-i1 (lienzo+layout), C.2-i2 (vista Dirigida editable, write-back a `AutomationRule`)

---

## 1. Objetivo

Completar la UX de edición de la vista Dirigida: **paleta de nodos** (añadir/insertar acciones por tipo), **campos amables** en el inspector para los tipos comunes, y **pulido visual** de los nodos. Todo aditivo sobre el modelo draft-object de i2.

## 2. Alcance

### Dentro de i3
- **Paleta de nodos**: picker agrupado por categoría (icono+label amable) que se abre desde un botón "Añadir" en la toolbar y desde un **"⊕" entre nodos** (arista custom de React Flow). Al elegir un tipo → inserta una acción de ese tipo en la posición.
- **Campos amables en el inspector**: para los ~8 tipos de acción comunes, campos tipados según el catálogo; para el resto, el `JsonField` actual de i2. "Ver JSON" desplegable siempre disponible. Mismo trato para el nodo **trigger** (campos por triggerType común + JSON de respaldo).
- **Pulido de nodos**: label+icono del catálogo y resumen por acción ("WhatsApp · bienvenida"); nodo etapa coloreado por `STAGE_COLORS[config.toStage]` + label de etapa; estados de selección/hover; densidad consistente B/N.
- **Deuda de i2 saldada**: `TRIGGER_TYPES` a constante compartida; `JsonField` re-sincroniza al editar por selectores.

### Fuera de i3
- **Ramas** (condiciones que bifurcan) → sub-proyecto aparte; el motor NO ejecuta ramas hoy (gate único → acciones lineales), requiere decisión de motor/schema.
- Cableado libre con aristas (`nodesConnectable` sigue `false`).
- Edición de cadencias (sigue read-only + deep-link, como i2).

## 3. Arquitectura

Todo el **write-back es idéntico a i2**: draft-object SOT → `draftToRulePayload` → `PUT/POST /api/admin/automation/rules`. i3 es **aditivo de UI** + una sola op pura nueva. **Sin endpoints nuevos, sin migración, sin cambio de motor.**

### 3.1 Catálogo de nodos (única fuente) — `src/lib/journey/node-catalog.ts` (puro)

Define, por `WorkflowActionType`, los metadatos que consumen lienzo + paleta + inspector, evitando divergencia (el problema que i2 dejó: labels amables solo en la vista read-only, enum crudo en edición).

```ts
export type NodeCategory = "Comunicación" | "Pipeline" | "Asignación" | "IA" | "Otros";

export type FieldKind = "text" | "number" | "select" | "stage" | "user" | "textarea";
export interface FieldDef {
  configKey: string;          // llave dentro de action.config (o "" para campos especiales)
  label: string;
  kind: FieldKind;
  options?: { value: string; label: string }[]; // para select
  placeholder?: string;
}

export interface NodeTypeMeta {
  type: string;               // WorkflowActionType
  category: NodeCategory;
  label: string;              // "💬 WhatsApp"
  summaryKey?: string;        // config key para el resumen en el nodo ("template" → "WhatsApp · bienvenida")
  fields?: FieldDef[];        // presente solo para los ~8 comunes; ausente → inspector usa JsonField
}

export const NODE_CATALOG: NodeTypeMeta[];      // todos los WorkflowActionType (label+categoría siempre)
export function paletteGroups(): { category: NodeCategory; items: NodeTypeMeta[] }[];
export function metaFor(type: string): NodeTypeMeta | undefined;
export function labelFor(type: string): string;        // amable, fallback al enum
export function summaryFor(type: string, config: Record<string, unknown>): string; // "WhatsApp · bienvenida"
```

- Tipos comunes con `fields` (contrato leído de `actions.ts` durante implementación): `SEND_WHATSAPP`, `SEND_EMAIL`, `MAKE_CALL`, `ASSIGN`, `CREATE_TASK`, `CHANGE_STAGE`, `ADD_TAG`, `NOTIFY`.
- El resto (`REASSIGN`, `UPDATE_FIELD`, `ENROLL_PLAN`, `ESCALATE`, `AI_DRAFT`, `AI_REPLY`, `AI_CALL_SUMMARY`, `WEBHOOK`, `SET_LIFECYCLE`, `GW_*`) → solo label+categoría → inspector usa `JsonField`.
- `ACTION_LABELS` de `journey-map.ts` se reemplaza por `labelFor()` (o se deja delegando al catálogo para no romper C.1).

### 3.2 Lógica pura nueva — `rule-draft.ts`
- `insertAction(draft, type, atIndex)`: inserta `{type, config:{}}` en `atIndex` (clamp a `[0, length]`) y reindexa `nodeId`. (`addAction` de i2 = `insertAction(.., length)`.)

### 3.3 Componentes
- **`node-palette.tsx`** (nuevo): popover/menú con `paletteGroups()`; props `{ onPick(type), onClose }`. Reusa clases CRM.
- **`insert-edge.tsx`** (nuevo): arista custom React Flow; renderiza un botón "⊕" centrado vía `EdgeLabelRenderer`; al click llama un callback `onInsertAt(index)` (el índice se deriva del id de la arista). Registrada en `edgeTypes`.
- **`rule-inspector-panel.tsx`** (rework): si el tipo seleccionado tiene `fields`, renderiza los controles tipados (cada uno lee/escribe su `configKey` vía `setActionConfig`, salvo `stage`→`toStage` y los especiales); si no, `JsonField`. Disclosure "Ver JSON". Trigger: campos por triggerType común (al menos `EVENT`→eventType, `STAGE_CHANGE`→toStage) + JSON de respaldo.
- **`journey-map-view.tsx`**: `nodeLabel` usa `labelFor`/`summaryFor`; nodo etapa usa `STAGE_COLORS[config.toStage]` + `LIFECYCLE_LABELS`; toolbar con botón "Añadir" que abre la paleta (inserta tras el nodo seleccionado o al final); `edgeTypes={{ insert: InsertEdge }}` con las aristas de inserción en modo edición.

### 3.4 Deuda de i2
- `TRIGGER_TYPES` exportado desde `src/lib/validations/rebuild-f1.ts` (junto a `workflowActionTypes`); inspector y `rules/route.ts` lo importan.
- `JsonField`: controlado por la prop `value` (o `key` derivada del contenido) para reflejar cambios externos (p. ej. tras elegir etapa en el select). El dato vive en el draft; el textarea debe seguirlo.

## 4. Servidor
**Sin cambios.** Reusa `POST/PUT /api/admin/automation/rules` + su zod.

## 5. Sin migración
i3 no toca el schema. Degradaciones de i1/i2 intactas.

## 6. Testing (TDD)
- **Pure** (`rule-draft.test.ts`): `insertAction` en borde inicial/medio/final + reindex + inmutabilidad.
- **Pure** (`node-catalog.test.ts`): todo `WorkflowActionType` tiene entrada con categoría+label; los 8 comunes tienen `fields` con `configKey` no vacío; `summaryFor` arma "WhatsApp · bienvenida"; `paletteGroups` cubre todos sin duplicar.
- **Component/build**: paleta agrupa por catálogo; inspector elige campos-tipados vs JSON según el tipo; build verde + tsc limpio.
- **Smoke Playwright** (autorizado, regla inactiva de prueba, borrar): añadir acción vía paleta → insertar con ⊕ → editar con campo amable (plantilla/etapa) → Guardar → verificar en BD vía MCP → borrar.

## 7. Proceso
spec → `writing-plans` → subagent-driven TDD (implementers Sonnet + spec/quality review + review holístico) → smoke → ff-push a `main` (autor Propyte-Luis) → auto-deploy Hostinger.

## 8. Riesgos / notas
- **Contratos de config por tipo**: los `fields` se derivan leyendo `actions.ts`. Si un tipo común tiene config más rica de lo esperado, dejar JSON para ese tipo antes que inventar campos. Verificar en implementación.
- **Aristas custom de React Flow**: el "⊕" vive en `EdgeLabelRenderer`; mapear id de arista → índice de inserción con cuidado (la arista `trigger->a0` inserta en 0, `a0->a1` en 1, etc.; la condición opcional desplaza índices — derivar del orden de `draft.actions`, no del id textual).
- **Worktree compartido / Prisma stale**: verificar HEAD antes de commit; `npx prisma generate` normal tras cualquier `npm install` ([[feedback_prisma_generate_no_engine]]). El worktree i3 necesita `npm install` (node_modules propio sin deps nuevas — pero @xyflow ya está en main).
