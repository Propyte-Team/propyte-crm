# C.2-i2 — Canvas editable: write-back grafo→motor

**Fecha:** 2026-06-25
**Sub-proyecto:** Fase 3 · C (canvas journey) · C.2 (editable) · incremento **i2**
**Rama:** `feat/crm-journey-canvas-i2` (worktree `.claude/worktrees/crm-journey-canvas-i2`, basada en `origin/main`=`0adf008`=i1)
**Predecesores:** C.1 (mapa read-only), C.2-i1 (lienzo React Flow + `journey_layouts`)

---

## 1. Objetivo

Hacer **editable** la vista **Dirigida** del canvas de journey, de modo que editar nodos escriba de vuelta a **una** `AutomationRule` real del motor. Es "la parte dura": el round-trip grafo→motor correcto.

## 2. Alcance

### Dentro de i2
- La vista **Dirigida** (flujo lineal de una regla) se vuelve editable. La vista **General** sigue read-only.
- Operaciones estructurales sobre la regla seleccionada:
  - Editar config de cualquier nodo (trigger / condición / acción / etapa) vía **inspector lateral**.
  - **Reordenar** acciones (controles ↑↓ en el inspector — NO drag).
  - **Borrar** un nodo de acción (botón/tecla con confirm).
  - **Toggle** activo/pausado de la regla.
  - **Añadir acción**: botón `+` con dropdown de `WorkflowActionType` → inserta una acción nueva al final.
  - **Crear regla lineal nueva** (trigger → etapa) desde cero.
- Write-back **solo a `AutomationRule`** vía la API existente `POST/PUT /api/admin/automation/rules`.
- Commit **explícito** ("Guardar"); borrador en cliente hasta confirmar.

### Fuera de i2 (→ i3)
- Paleta visual de tipos de nodo arrastrables al lienzo.
- **Ramas**: condiciones que bifurcan en múltiples caminos (árbol + múltiples aristas + mini-compilador).
- Cableado libre con aristas (`nodesConnectable`).
- Pulido visual fino.

### Fuera de i2 (queda en su editor dedicado)
- Edición de **cadencias** (`ActionPlan`/`ActionPlanStep`). Los nodos de cadencia en el lienzo son **read-only**; al hacer click, deep-link a `/configuracion` (config-center → `cadence-editor.tsx`). Razón: editar pasos con *enrollments* en vuelo recoloca contactos (`currentStep` es índice int) — riesgo conocido, no se trae a la "parte dura".

## 3. Arquitectura — borrador-objeto como fuente de verdad

El draft (objeto con la **misma forma** que los campos editables de `AutomationRule`) es la verdad. El lienzo y el inspector son **dos proyecciones** del draft. No hay "compilador de grafo": como el draft ya tiene la forma de la regla, el round-trip es correcto por construcción. Extiende natural a i3 (cuando lleguen ramas, `actions` evoluciona a árbol y ahí sí entra un mini-compilador).

### 3.1 Pieza central nueva: `src/lib/journey/rule-draft.ts` (puro, testeable)

```ts
export interface ActionDraft {
  nodeId: string;          // ID estable "a<index>" para el lienzo + layout
  type: WorkflowActionType;
  config: Record<string, unknown>;
  delayMinutes?: number;
}

export interface RuleDraft {
  id?: string;             // undefined = regla nueva
  name: string;
  description: string | null;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  conditions: ConditionNode; // DSL all/any/leaf (reusa el tipo de rebuild-f1)
  actions: ActionDraft[];    // orden = secuencia
  priority: number;
  cooldownMinutes: number | null;
  isActive: boolean;
}

// Conversiones (round-trip identidad garantizado por tests)
ruleToDraft(rule: AutomationRule): RuleDraft
draftToRulePayload(draft: RuleDraft): RulePayload   // forma exacta del zod ruleSchema existente

// Render (extiende targetedToFlow de i1; mismo esquema de IDs)
draftToFlow(draft: RuleDraft): Flow                 // { nodes, edges }

// Ops puras (devuelven RuleDraft nuevo, inmutable)
addAction(draft, type): RuleDraft
removeAction(draft, nodeId): RuleDraft
reorderAction(draft, nodeId, dir: "up"|"down"): RuleDraft
setActionConfig(draft, nodeId, patch): RuleDraft
setTrigger(draft, { triggerType, triggerConfig }): RuleDraft
setConditions(draft, conditions): RuleDraft
setMeta(draft, { name, description, priority, cooldownMinutes, isActive }): RuleDraft
```

**IDs estables**: el nodo de trigger = `"trigger"`, condición = `"condition"`, acción `i` = `"a{i}"`, etapa = `"stage"`. Al reordenar/añadir/borrar, los IDs `a{i}` se reindexan; las posiciones de `journey_layouts` degradan a auto-layout para los IDs que cambiaron (igual que i1, sin romper).

### 3.2 Componentes (cliente)

- **`useRuleDraft`** (hook, `src/components/journey/use-rule-draft.ts`): mantiene `draft`, `isDirty`, expone las ops puras envueltas, y `save()`/`discard()`. Sin estado global; vive en la vista.
- **`RuleInspectorPanel`** (`src/components/journey/rule-inspector-panel.tsx`): panel derecho. Renderiza campos **según el tipo del nodo seleccionado**:
  - trigger → selector `TriggerType` + campos de `triggerConfig` por tipo.
  - condición → reusa `condition-tree.tsx` (editor DSL existente).
  - acción → selector `WorkflowActionType` + campos de `config` por tipo + `delayMinutes` + ↑↓ + borrar.
  - etapa → selector de etapa destino (la acción `CHANGE_STAGE`).
  - meta (regla) → name/description/priority/cooldown/isActive cuando no hay nodo seleccionado.
- **`journey-map-view.tsx`** (extender): en la vista Dirigida, modo edición. El **drag de React Flow sigue siendo reposicionar (layout i1)**. `nodesConnectable` permanece `false` en i2. Selección de nodo abre el inspector. Botón "Guardar" + indicador dirty + "Crear regla".

### 3.3 Flujo de datos

1. Cargar regla (GET existente) → `ruleToDraft` → `draft` en estado.
2. `draftToFlow(draft)` → nodos/aristas → React Flow; posiciones desde `journey_layouts` (`applyPositions`, igual i1).
3. Seleccionar nodo → inspector → edición llama op pura → nuevo `draft` → re-render del flow.
4. **Guardar**: `draftToRulePayload(draft)` → zod (cliente para feedback + server autoritativo) → `PUT` (si `id`) o `POST` (nueva) a `/api/admin/automation/rules`. Si `draft.isActive` → diálogo de confirmación "esto aplica a disparos nuevos". Éxito → limpiar dirty + refrescar.

## 4. Servidor

**Sin endpoints nuevos.** Reusa `POST/PUT /api/admin/automation/rules` (createRule/updateRule, zod `ruleSchema`, RBAC ADMIN/DIRECTOR, AuditLog). El write-back es 100% por estas rutas.

## 5. Seguridad / validación

- RBAC ADMIN/DIRECTOR (heredado de las rutas). La página `/journey` ya está protegida.
- `draftToRulePayload` produce exactamente lo que el `ruleSchema` valida; el server es la autoridad.
- Cada acción conserva su `delayMinutes`; el **orden** de `actions[]` es la secuencia → reordenar cambia semántica real.
- Confirmación al guardar reglas activas. Nada toca el motor hasta "Guardar".

## 6. Sin migración

i2 no toca el schema: `journey_layouts` ya existe (i1) y `AutomationRule` se escribe por API existente. **Sin gate de infra.** Degradación pre-existente de i1 (layout best-effort) se mantiene.

## 7. Testing (TDD)

Unitarios puros (`rule-draft.test.ts`):
- **Round-trip identidad**: `draftToRulePayload(ruleToDraft(rule))` ≡ payload canónico de `rule` (sobre los 8 workflows seed §D.5).
- Cada op pura: `addAction`/`removeAction`/`reorderAction`(up/down en bordes)/`setActionConfig`/`setTrigger`/`setConditions`/`setMeta` → inmutabilidad + resultado esperado.
- `draftToFlow`: nodos/aristas correctos para cadena de N acciones, con/sin condición, IDs estables.
- Validación: draft inválido (sin trigger, acción sin type) → `draftToRulePayload` o el zod rechaza.

Integración/componente:
- Inspector renderiza campos correctos por tipo de nodo.
- "Guardar" llama `PUT`/`POST` con el payload correcto; muestra aviso si `isActive`.
- "Crear regla" arranca un draft mínimo válido.

## 8. Proceso

spec (este doc) → `writing-plans` → subagent-driven TDD (2 implementers Sonnet + review Opus) → verificación → ff-push a main (autor Propyte-Luis) → auto-deploy Hostinger.

## 9. Riesgos / notas

- **Reindexado de IDs** al editar la cadena: las posiciones guardadas de los nodos movidos se pierden (degradan a auto-layout). Aceptable en i2; i3 puede persistir por identidad lógica si molesta.
- **`condition-tree.tsx`**: verificar su API de props al integrarlo en el inspector; si su contrato no encaja, envolver, no reescribir.
- **Worktree compartido**: el patrón de worktrees de este repo brinca de rama entre turnos por uso paralelo — verificar `HEAD` antes de cada commit ([[feedback_propyte_hub_shared_worktree]]).
- **Prisma stale tras npm install**: si se instala cualquier dep, correr `npx prisma generate` normal antes de typecheck/build ([[feedback_prisma_generate_no_engine]]).
