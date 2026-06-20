# Flujos & SLA — Fase 2: Builder paridad-Zoho — Spec de implementación

**Fecha:** 2026-06-20
**Proyecto:** Propyte CRM (`propyte-crm`)
**Estado:** Aprobado por Luis (diseño). Listo para plan de implementación.
**Diseño base:** `docs/superpowers/specs/2026-06-20-flujos-lifecycle-builder-design.md`
**Fase 1 (Fundación):** desplegada en `35b9053`.

## 1. Objetivo

Que Luis arme en el editor visual (`/configuracion` → Workflows & SLA) **toda la segmentación
que hoy hace en Zoho**, sin tocar BD ni JSON crudo: branchear por campaña, setear tipo/fuente/etapa,
asignar, etiquetar, y disparar acciones diferidas (+10 min). Esta fase es **paridad-Zoho en la UI**;
el canvas tipo HubSpot es Fase 3.

## 2. Decisiones (OQ resueltas)

- **OQ1 — Empleo:** `ContactType.EMPLEO` como **valor de enum nuevo** (migración aditiva). Sin
  `CANDIDATO` (YAGNI). Se setea vía `UPDATE_FIELD` igual que `LEAD`/`BROKER`.
- **OQ2 — Segmentación primaria:** por **campaña** (`adAttribution.campaignName`, ya capturada en
  Fase 1). El `form_id` queda en `contact.custom` como respaldo; no se hace fetch extra a Meta.
- **OQ3+OQ4 — Canvas (Fase 3):** reusar el motor (`AutomationRule` + `ActionPlan`) con una capa
  visual; journey lineal con ramas. Fuera del alcance de esta fase.
- **OQ5 — Lifecycle stages del contacto:** sí, pero en Fase 3. Fuera de alcance aquí.

## 3. Estado actual verificado (código)

- `src/components/config/workflow-builder.tsx` — builder por formulario (trigger + condiciones DSL
  plano + acciones). Contiene lógica pura embebida (`buildTriggerConfig`, `buildConditions`,
  `parseValue`, `nodeToRows`) no testeable de forma aislada.
- `src/lib/workflows/engine.ts` — `matchesTrigger` lee `cfg.toStage` para `STAGE_CHANGE`
  (línea 19); el motor respeta `spec.delayMinutes` al encolar (línea 106); el contexto del DSL ya
  expone `adAttribution` (línea 58).
- `src/lib/workflows/evaluate-conditions.ts` — el evaluador soporta `all`/`any` **anidados**.
- `src/lib/validations/rebuild-f1.ts` — `actionSpecSchema` (a verificar que acepte `delayMinutes`
  top-level; el motor ya lo lee).

## 4. Brechas → entregables

### A. Extracción testeable (habilitador de TDD) — sin cambio funcional
Mover la lógica pura del builder a `src/lib/workflows/builder-model.ts`:
- `buildTriggerConfig(triggerType, triggerValue)`
- `parseValue(op, raw)`
- `buildConditions(tree)` y `parseConditions(node)` (árbol ↔ DSL, soporta anidación — ver §E)
- Tipos `CondLeaf`, `CondGroup`, `ConditionTree`, `ActionRow`
El componente `workflow-builder.tsx` solo orquesta estado/JSX e importa de `builder-model`.
**Criterio:** el componente no contiene lógica de serialización; toda vive en el módulo puro.

### B. Fix bug STAGE_CHANGE
- `buildTriggerConfig` para `STAGE_CHANGE` devuelve `{ toStage: triggerValue }` (no `{ stage }`).
- Init de `triggerValue` lee `rule?.triggerConfig?.toStage ?? rule?.triggerConfig?.stage`
  (compatibilidad: reglas ya guardadas con la clave vieja `stage` siguen abriendo bien).
**Criterio:** una regla creada en el builder con etapa `RESERVED` matchea un evento
`deal.stage_changed` con `payload.toStage = "RESERVED"` (test de round-trip builder→`matchesTrigger`).

### C. `delayMinutes` por acción en el builder
- `ActionRow += delayMinutes?: string`.
- Input "Retrasar (min)" por acción en la tarjeta de acción.
- El payload incluye `delayMinutes: Number(...)` por acción cuando > 0; se omite si vacío/0.
- Verificar/ajustar `actionSpecSchema` para aceptar `delayMinutes` (entero ≥ 0, opcional) top-level.
**Criterio:** una acción con "Retrasar = 10" produce un `ActionQueue.runAfter ≈ now + 10 min`
(test sobre el encolado / passthrough del schema).

### D. Selector de campos enriquecido
Agregar a `FIELD_SUGGESTIONS` (datalist, no rompe escritura libre):
- `contact.contactType`
- `adAttribution.campaignName`, `adAttribution.adName`, `adAttribution.adsetName`,
  `adAttribution.network`
- `contact.custom.` (hint de prefijo para campos de formulario)
Mantener los existentes. **Sin cambios en el motor** (el contexto ya expone `adAttribution`).
**Criterio:** las sugerencias incluyen los campos nuevos; condicionar por
`adAttribution.campaignName contains "BROKER"` funciona end-to-end (ya soportado por el motor).

### E. Condiciones anidadas — 2 niveles
Modelo de árbol con profundidad fija = 2 (paridad Zoho "all dentro de any"):
- **Grupo raíz**: `{ combinator: "all"|"any", items: Item[] }`.
- **Item** = condición hoja (`{ field, op, value }`) **o** sub-grupo
  (`{ combinator, conditions: CondLeaf[] }`) — los sub-grupos NO anidan más (depth 2).
- UI: botón "Agregar grupo" además de "Agregar condición"; cada grupo con su selector
  `todas/cualquiera`.
- `buildConditions(tree)` serializa al DSL `{ all|any: [ ...leaf, { all|any: [...] } ] }`.
- `parseConditions(node)` reconstruye el árbol desde el DSL guardado (reemplaza `nodeToRows`).
**Criterio:** round-trip de un DSL anidado (`any` con un `all` dentro) UI→DSL→UI es idempotente
(unit test); el motor evalúa el resultado correctamente.

### F. `ContactType.EMPLEO` (enum) — requiere OK de Luis para aplicar migración
- `prisma/schema.prisma`: agregar `EMPLEO` al enum `ContactType`.
- Migración aditiva manual `prisma/migrations-manual/2026-06-20-contacttype-empleo.sql`:
  `ALTER TYPE "ContactType" ADD VALUE IF NOT EXISTS 'EMPLEO';`
  (additiva, no destructiva; `ADD VALUE` no corre dentro de transacción en algunos PG — script suelto).
- `UPDATE_FIELD` ya valida `contactType` contra el enum de Prisma → sin cambio de builder ni handler.
- **Gate:** la migración se aplica a la **BD compartida** solo con OK explícito de Luis por acción.
  El código (schema + `prisma generate`) puede prepararse antes; aplicar SQL + regenerar después del OK.
**Criterio:** tras la migración, `UPDATE_FIELD { field: "contactType", value: "EMPLEO" }` persiste sin
error de enum; una regla de plantilla "Empleo" lo setea.

### G. Plantillas de regla ("recetas")
Catálogo en `src/lib/workflows/builder-templates.ts` con 3 plantillas; cada una es un objeto de regla
pre-llenado (trigger + condiciones + acciones) que el builder carga en el form (editable antes de
guardar). Dropdown "Usar plantilla" arriba del form.
- **Lead** — `adAttribution.campaignName contains "[LEADS]"` (o sin marcador) →
  `UPDATE_FIELD contactType=LEAD`, `UPDATE_FIELD leadSource=<META>`, `ASSIGN`, `ADD_TAG lead`.
- **Broker** — `... contains "BROKER"` → `contactType=BROKER_EXTERNO`,
  `leadSource=REGISTRO_BROKER`, `ASSIGN`, `ADD_TAG broker`.
- **Empleo** — `... contains "EMPLEO"` → `contactType=EMPLEO`, `leadSource=<...>`,
  `ASSIGN` (reclutador), `ADD_TAG empleo`.
**Nota:** los valores exactos de `leadSource` y la estrategia de `ASSIGN` se confirman contra los
enums reales (`LeadSource`) y `RoutingRule` al implementar; las plantillas usan valores válidos del
enum, no inventados. **Criterio:** seleccionar una plantilla pre-llena el form con un objeto de regla
válido contra el schema de la API (`/api/admin/automation/rules`).

## 5. Fuera de alcance (Fase 3)

Editor visual de cadencias (ActionPlan), canvas de journey, SLA por segmento, `SEND_EMAIL`/`MAKE_CALL`
en vivo, lifecycle stages del contacto, métricas del journey.

## 6. Plan de pruebas

- **Unit (Vitest):** `builder-model` (`buildTriggerConfig` STAGE_CHANGE→`toStage`; `parseValue`;
  `buildConditions`/`parseConditions` round-trip anidado e idempotente); `matchesTrigger` STAGE_CHANGE
  con `toStage`; passthrough `delayMinutes` (schema + `runAfter`); shape de cada plantilla válido
  contra el zod de la API.
- **Playwright (Windows — script standalone + subprocess + JSON temp):** abrir el builder, crear regla
  con etapa + acción diferida + grupo anidado, guardar, reabrir y verificar round-trip; usar plantilla
  Broker y guardar.
- **Verificación BD (post-OK migración):** `UPDATE_FIELD contactType=EMPLEO` persiste (MCP Supabase
  o lead real; NO con la Lead Ads Testing Tool de Meta, que manda dummies).

## 7. Proceso de entrega

- subagent-driven: por task → implementer (Sonnet) + spec-review + code-quality-review.
- TDD estricto (test rojo → verde), build verde antes de cada commit.
- Autoría git Propyte (`Propyte-Luis` / `webkoi@webkoi-ai.com`); verificar HEAD + rama antes de cada
  commit (working tree compartido).
- Merge ff a `main` (auto-deploy Hostinger). La migración F se aplica aparte, con OK explícito.

## 8. Orden de implementación

1. **A** — extracción a `builder-model.ts` (con tests de la lógica existente, sin cambio funcional).
2. **B** — fix STAGE_CHANGE.
3. **C** — `delayMinutes` por acción.
4. **D** — campos enriquecidos.
5. **E** — condiciones anidadas (2 niveles).
6. **G** — plantillas de regla.
7. **F** — enum `EMPLEO` (código listo; SQL aplicado al recibir OK de Luis).

A–E y G no tocan BD; F es la única que requiere migración.
