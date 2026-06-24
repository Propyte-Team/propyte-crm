# Editor de Cadencias (ActionPlan) — Diseño (Fase 3 · sub-B)

**Fecha:** 2026-06-24
**Proyecto:** Propyte CRM (`propyte-crm`)
**Estado:** Aprobado por Luis (brainstorming 2026-06-24). Segundo sub-proyecto de Fase 3.
**Rama:** `feat/crm-cadence-editor` (worktree aislado desde `origin/main` `8bc7855`).

## 1. Visión

Dar a Luis un **editor visual** para crear y editar **cadencias** (secuencias multi-paso de acciones con
retrasos), sin tocar BD ni API a mano. Es la fundación sobre la que después se construye el canvas de
journey (sub-C). Hoy el backend de cadencias está completo pero **no hay UI de autoría**: la sección de
/configuracion solo lista cadencias en read-only y dice literalmente *"Se crean desde la API o el builder
(próxima fase)"*.

## 2. Estado actual (lo que YA existe)

- **Modelo completo:** `ActionPlan` (name, description, isActive, ownerUserId, entryTrigger Json,
  exitConditions Json, steps[], enrollments[]) + `ActionPlanStep` (order, delayMinutes, actionType,
  config Json, conditions Json?, autonomyLevel) + `ActionPlanEnrollment` (currentStep, status, nextRunAt).
- **Scheduler:** `runEnrollments` (cron) avanza enrollments paso a paso, encola la acción de cada paso,
  calcula `nextRunAt` por `delayMinutes`. `enrollInPlan` enrola un entity.
- **Enrolamiento:** vía la acción `ENROLL_PLAN` de las reglas del builder (decisión Luis: **solo así**;
  el editor de cadencias NO maneja disparador de entrada).
- **API `/api/admin/automation`:** `GET` devuelve plans (listado) + `PATCH` togglea `isActive` de un plan.
  **No hay create/update/delete de planes ni de pasos.**
- **UI `automation-section.tsx`** (en /configuracion): lista cadencias (nombre, # pasos, # enrolados) con
  switch de activar/pausar. Sin crear/editar.
- **Reutilizable:** DSL de condiciones `evaluateConditions` (`src/lib/workflows/evaluate-conditions.ts`,
  ya testeado, recursivo) + `buildContext` (`engine.ts`, expone contact/deal/adAttribution/lifecycleStage)
  + componentes del rule builder (`workflow-builder.tsx`: `ACTION_TYPES`, `ACTION_FIELDS`, constructor de
  condiciones) + `builder-model.ts` (lógica pura).

## 3. Decisiones (cerradas en brainstorming)

1. **Enrolamiento:** solo vía reglas (`ENROLL_PLAN`). El editor no expone `entryTrigger`.
2. **Condiciones v1:** cada paso = retraso + acción + nivel de autonomía; MÁS **condiciones de salida**
   del plan (`exitConditions`). **Sin** condiciones por-paso (el modelo las guarda, sin UI por ahora).
3. **Ubicación:** sección embebida en /configuracion (donde ya vive el listado), no página aparte.

## 4. Hallazgo crítico de alcance

`runEnrollments` **NO evalúa `exitConditions` hoy** — solo sale cuando se acaban los pasos o el plan se
desactiva. La función estrella que Luis eligió (salir de la cadencia si el contacto ya respondió) **no
existe en backend**. Por tanto sub-B incluye implementar esa evaluación, no solo la UI.

## 5. Arquitectura — 3 capas

### 5.1 Backend: evaluación de `exitConditions` en el scheduler
En `runEnrollments`, para cada enrollment due y ANTES de encolar el paso: si `plan.exitConditions` no está
vacío, construir el contexto del entity (`buildContext` necesita un `WorkflowEvent`; en el scheduler no hay
evento, así que se extrae/reusa la carga de contexto del entity — ver §5.1.1) y evaluar con
`evaluateConditions`. Si matchea → marcar enrollment `EXITED` + `exitedAt` + `nextRunAt=null`, continuar
(no encolar). Forward-safe, idempotente.

#### 5.1.1 Carga de contexto sin evento
`buildContext(event)` hoy depende de un `WorkflowEvent`. Para reusarlo desde el scheduler se extrae un
helper `loadEntityContext(entityType, entityId)` (en `engine.ts`) que arma el mismo objeto
`{ contact, deal, adAttribution, ... }` sin requerir un evento; `buildContext` pasa a delegar en él. Así el
scheduler y el motor comparten exactamente la misma forma de contexto (DRY, sin divergencia del DSL).

### 5.2 API: CRUD de cadencias — `/api/admin/automation/plans`
- `POST` — crear plan: `{ name, description?, exitConditions?, steps: Step[] }`.
- `PUT [id]` — editar plan + **reemplazar** sus pasos (transacción: borra los steps del plan y recrea con
  `order` 0..n-1; patrón simple y atómico que evita reconciliación de diffs de orden).
- `DELETE [id]` — soft-delete (`deletedAt`).
- `Step = { actionType, delayMinutes, config, autonomyLevel }`.
- **Validación zod:** `actionType ∈ workflowActionTypes` (el enum zod canónico, que ya incluye
  `SET_LIFECYCLE`); `delayMinutes ≥ 0` int; `autonomyLevel ∈ {L0,L1,L2}`; `exitConditions` con el schema
  `ConditionNode` existente. RBAC admin (mismo guard que las demás rutas `/api/admin/*`).
- El `PATCH` de toggle se queda donde está (`/api/admin/automation`) sin cambios.

### 5.3 UI: editor en /configuracion
Componente nuevo `src/components/config/cadence-editor.tsx`, montado por `automation-section.tsx`:
- Lista de cadencias (reusa el listado actual) + botón **"Nueva cadencia"** y **"Editar"** por fila.
- Editor (modal o panel inline): **nombre**, **descripción**, **condiciones de salida** (reusa el
  constructor de condiciones del rule builder — árbol `all/any` + `CondRowFields`), y **lista ordenada de
  pasos**. Cada paso: **retraso (min)** + **acción** (selector `ACTION_TYPES` + campos de `ACTION_FIELDS`,
  incluye `SET_LIFECYCLE`) + **nivel de autonomía** (L0/L1/L2). Acciones por paso: agregar, quitar,
  reordenar (subir/bajar).
- Guardar → POST/PUT a `/plans`. Activar/pausar con el toggle existente.
- Lógica pura testeable extraída a `src/lib/workflows/cadence-model.ts` si crece (mapear filas UI ↔ steps);
  reusar `builder-model.ts` donde aplique.
- Composición con oficio, coherente con el rule builder (no admin-template). Ver
  `feedback_ui_craft_no_admin_template`.

## 6. Modelo de datos

**Sin cambios de schema.** Reusa `ActionPlan`/`ActionPlanStep`/`ActionPlanEnrollment` tal cual.
`entryTrigger` queda sin uso (default `{}`); las condiciones por-paso (`ActionPlanStep.conditions`) quedan
sin UI (default null). **No hay migración** → no hay gate de infra para este sub-proyecto.

## 7. Testing (TDD)

- **Scheduler:** `runEnrollments` (a) sale `EXITED` cuando `exitConditions` matchea (sin encolar el paso);
  (b) corre normal cuando no matchea; (c) sin `exitConditions` se comporta igual que hoy (no regresión);
  (d) plan inactivo o sin pasos siguientes sigue igual.
- **loadEntityContext:** devuelve la misma forma que el `buildContext` actual para un contact/deal.
- **API:** zod rechaza `actionType` inválido; el `PUT` recrea steps con `order` 0..n; `DELETE` hace
  soft-delete; RBAC rechaza no-admin.
- **cadence-model (si se crea):** mapeo filas↔steps preserva orden y config.
- Reusa `evaluate-conditions.test.ts` (DSL ya cubierto). **NO** E2E Playwright salvo que Luis lo pida.

## 8. Alcance v1 (YAGNI)

- **SÍ:** evaluación de `exitConditions` en scheduler + `loadEntityContext` + CRUD API de planes/pasos +
  editor UI (pasos lineales con retraso/acción/autonomía + condiciones de salida).
- **NO:** condiciones por-paso (modelo las guarda, sin UI), disparador de entrada propio del plan, canvas
  visual de journey (sub-C), métricas por paso (sub-F), plantillas de cadencia pre-armadas (posible
  follow-up).

## 9. Riesgos / lecciones aplicadas

- **Enum en 4 lugares:** cualquier `actionType` en pasos se valida contra el zod `workflowActionTypes`
  (mismo enum canónico del rule builder) — no re-listar a mano. Ver `feedback_db_enum_vs_zod_enum`.
- **Worktree compartido:** trabajo en worktree aislado; autoría `Propyte-Luis` verificada antes del push;
  ff-merge a main solo con OK de Luis (dispara auto-deploy). Ver `feedback_propyte_hub_shared_worktree`.
- **Reuso del DSL:** extraer `loadEntityContext` en vez de duplicar la carga de contexto evita que el
  scheduler y el motor evalúen condiciones de forma divergente.
