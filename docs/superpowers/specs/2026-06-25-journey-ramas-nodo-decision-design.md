# Ramas en el motor de workflows — Nodo de decisión (árbol)

**Fecha:** 2026-06-25
**Sub-proyecto:** Fase 3 — "ramas" (decisión de motor)
**Rama:** `feat/crm-journey-ramas` (worktree `.claude/worktrees/crm-journey-ramas`, desde `origin/main` `f8cbd7c`)
**Estado del diseño:** aprobado por Luis (brainstorming con visual companion)

## Problema

El motor de workflows hoy ejecuta una `AutomationRule` como **compuerta única → acciones lineales**: evalúa `rule.conditions` una vez y, si pasa, encola **todas** las acciones en secuencia. No hay `if/else`, no hay condición por-acción. Para "bifurcar" hoy hay que crear **N reglas sueltas** con condiciones opuestas.

Luis necesita **un solo workflow con bifurcación anidada**: una sola jornada que se ramifica según de dónde vino el cliente (Meta / broker externo / web / …) y, dentro de cada rama, posiblemente otra decisión (p. ej. `META y presupuesto>5M`). Cada camino hace asignación y actividades de seguimiento distintas. Maneja 5 tipos de cliente (broker, lead, proveedor, desarrollador, candidato de empleo) y quiere expresarlos como ramas de un mismo árbol, no como reglas dispersas.

Requisitos confirmados (brainstorming):
- **A** — switch multi-vía por un dato (una pregunta → N caminos paralelos).
- **B** — anidamiento (una rama abre otra decisión, con guardas posiblemente compuestas).
- **NO** se pidió "C" (reunión/*merge* de ramas) → **sin semántica de join**.

## Decisión de arquitectura

**Enfoque elegido: nodo de decisión recursivo dentro de UNA regla** (árbol real), por encima de "multi-regla agrupada".

La multi-regla no toca el motor pero, con anidamiento, explota en reglas duplicadas (cada hoja carga toda la cadena de condiciones de sus ancestros) y obliga al canvas a re-armar el árbol adivinando desde reglas planas. El nodo de decisión hace que **el árbol *sea* el dato**: una regla = un workflow, el canvas lo dibuja 1:1, anidar = agregar un nodo, y reusa el DSL de condiciones y el `ConditionTreeEditor` ya construidos en i2/i3.

## Modelo de datos

`AutomationRule.actions` pasa de `ActionSpec[]` a **`WorkflowNode[]`**.

```ts
type WorkflowNode = ActionNode | DecisionNode

// ActionNode = el ActionSpec actual + discriminador opcional.
// kind ausente ⇒ "action" → compatibilidad hacia atrás con filas existentes.
ActionNode = {
  kind?: "action"
  type: WorkflowActionType        // sin cambios (los 17 de workflowActionTypes)
  config: Record<string, unknown>
  delayMinutes?: number           // offset desde el evento, NO acumulado (igual que hoy)
  autonomyLevel?: "L0" | "L1" | "L2"
}

DecisionNode = {
  kind: "decision"
  label?: string                  // cosmético, p. ej. "Por origen"
  branches: Array<{
    label?: string                // "META", "WEB", "BROKER"…
    conditions: ConditionNode | {} // reusa conditionsDslSchema (all/any/leaf)
    steps: WorkflowNode[]         // recursivo → habilita anidamiento (B)
  }>
  else?: WorkflowNode[]           // camino por defecto si ninguna rama cumple (opcional)
}
```

**Decisiones de modelo:**
- **Cada rama lleva su propia `conditions`** (no un `switch` por un único campo). Multi-vía (A) = N ramas, cada una `{field eq value}`; guarda compuesta (B, `META y ppto>5M`) = una rama con `all:[...]`. Un solo modelo cubre ambos y maximiza reuso del DSL existente.
- **Semántica de evaluación:** ramas en orden, **la primera cuya `conditions` cumple gana**; si ninguna cumple y hay `else`, se toma `else`; si no, ese subárbol no encola nada. Determinista.
- **Compat hacia atrás:** una fila vieja (`ActionSpec[]` sin `kind`) parsea como árbol de puros nodos-acción. **Cero migración de filas, cero migración de tabla** (es JSONB).
- **Alcance del cambio de modelo:** solo `AutomationRule.actions`. `ActionPlanStep` (cadencias) sigue lineal con sus `exitConditions`; no se anidan cadencias y `ActionPlanStep.conditions` permanece como está (fuera de alcance).

## Motor (engine + scheduler)

Hoy `engine.ts` (`processEvent`) y `scheduler.ts` (`runInactivityRules`) iteran `rule.actions` y encolan cada una. Se introduce un **walker recursivo puro**, `walkNodes`, reutilizado por ambos:

- **Firma pura** (sin BD): `walkNodes(nodes: WorkflowNode[], ctx) → EnqueueSpec[]`, donde `EnqueueSpec` = `{ actionType, config, delayMinutes, autonomyLevel, path }`.
- **Contexto:** el mismo `{ contact, deal, event, adAttribution, context }` que ya arma `buildContext` (engine) y el contexto reducido de `runInactivityRules`.
- **Nodo acción** → produce un `EnqueueSpec` (igual que hoy: `delayMinutes` = offset desde el evento, no acumulado por camino).
- **Nodo decisión** → evalúa `evaluateConditions(branch.conditions, ctx)` rama por rama; primera que cumple → recursa en sus `steps`; si ninguna → `else` (si existe). **Solo se materializa el camino tomado.**
- **`dedupeKey`:** hoy usa el índice `idx` (`${ruleId}:${entityId}:${type}:${idx}:${dayBucket}`). Pasa a usar la **ruta del nodo** (`path`, p. ej. `"0"`, `"1.b0.2"`) en lugar de `idx`. Estable y única por camino; mantiene la idempotencia (§D.7).
- El gate global `rule.conditions` se conserva: primero decide si la regla aplica; luego el walker decide el camino interno. (Una regla puede no tener decisiones → comportamiento idéntico al actual.)

`walkNodes` puro permite cubrir caminos con tests sin tocar la cola ni la BD.

## Canvas / UI (extiende i1-i3)

- **`rule-draft.ts`** — `RuleDraft.actions` ahora es árbol. Ops puras nuevas: `addDecision`, `removeDecision`, `addBranch`, `removeBranch`, `setBranchConditions`, `setBranchLabel`, `moveNode`/insert, además de las de acción ya existentes. Se mantiene el invariante "borrador = misma forma que la fila" → round-trip exacto (`ruleToDraft`/`draftToRulePayload` siguen siendo identidad sobre `actions`).
- **`draftToFlow`** — proyecta el árbol a React Flow: nodo decisión = **rombo ◆** con **una arista por rama** (etiquetada con el label/condición) hacia los `steps` de esa rama; `else` = arista "por defecto". IDs estables derivados de la ruta.
- **Paleta (i3)** — se suma **"Añadir decisión"**; el ⊕ entre nodos puede insertar acción o decisión.
- **Inspector** — editor de nodo decisión: lista de ramas, cada una con su `ConditionTreeEditor` (reusado de builder-model.ts) + label; agregar/quitar rama; toggle `else`.
- **Vista General** sigue read-only; toda la edición de ramas vive en la vista **Dirigida** (la editable de i2).

## Pruebas

- **Unit `walkNodes`:** camino tomado, multi-vía (A), anidado (B), `else`, ninguna rama cumple sin `else`, lista plana (compat), orden "primera gana".
- **Unit `rule-draft` ops:** add/remove decisión y rama, setBranchConditions, move/insert; round-trip `ruleToDraft → draftToRulePayload`.
- **Unit `draftToFlow`:** proyección de decisión a rombo + aristas por rama + arista else; IDs estables.
- **Unit zod:** acepta árbol válido y lista plana vieja; rechaza decisión sin `branches`, rama sin `conditions`, `kind` desconocido.
- Mantener la suite verde (~353 actuales) + sumar los del árbol.

## Alcance y entrega

- **Sin migración** (JSONB) → sin gate de infra. Compatible con reglas existentes.
- **Fuera de alcance (futuro):** reunión/*merge* de ramas (la "C"), anidar cadencias, condiciones por-paso de cadencia, split aleatorio A/B.
- **Proceso:** subagent-driven TDD (implementers Sonnet por clúster + review final Opus), smoke en vivo Playwright autorizado antes de merge, ff-push a `main` → auto-deploy Hostinger. Worktree aislado `crm-journey-ramas`.
- **Caveat anotado:** editar el árbol de una regla con acciones en vuelo puede recalcular rutas (`dedupeKey`) → mismo tipo de aviso que cadencias; señalar en UI cuando aplique.

## Los 4 lugares de la verdad (recordatorio de lecciones previas)

Cambios al shape de `actions` deben mantenerse consistentes en: (1) **zod** `actionSpecSchema`/nuevo `workflowNodeSchema` en `validations/rebuild-f1.ts`; (2) **motor** `engine.ts` + `scheduler.ts` (walker); (3) **canvas** `rule-draft.ts` + `draftToFlow` + inspector; (4) **catálogo** `node-catalog.ts` (i3). Un desajuste = fallas silenciosas (lección [[feedback_db_enum_vs_zod_enum]] reforzada en sub-A).
