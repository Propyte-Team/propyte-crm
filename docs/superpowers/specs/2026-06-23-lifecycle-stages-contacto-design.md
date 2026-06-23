# Lifecycle Stages del Contacto — Diseño (Fase 3 · sub-proyecto A)

**Fecha:** 2026-06-23
**Proyecto:** Propyte CRM (`propyte-crm`)
**Estado:** Aprobado por Luis (brainstorming 2026-06-23). Primer sub-proyecto de Fase 3.
**Rama:** `worktree-crm-lifecycle-stages` (worktree aislado desde `origin/main` `5e7cd09`).

## 1. Visión

Formalizar el **ciclo de vida del comprador/inversionista** como un eje propio y ordenado del
contacto (tipo HubSpot), separándolo de la *categoría* (qué tipo de contacto es) y del *estado de
gestión* (`contactStatus`). Esto da la base de datos sobre la que se construyen el canvas de journey
(componente C) y las métricas por etapa (componente F) de Fase 3.

## 2. Estado actual (lo que se reinterpreta)

El contacto hoy mezcla tres ejes que se traslapan:
- **`contactType`** (`ContactType`): `LEAD, PROSPECTO, CLIENTE, INVERSIONISTA, BROKER_EXTERNO, REFERIDO, EMPLEO` — mezcla *progresión* (LEAD→PROSPECTO→CLIENTE) con *categoría* (BROKER/EMPLEO/REFERIDO/INVERSIONISTA no son etapas).
- **`contactStatus`** (`ContactStatus`): `NUEVO, SIN_RESPUESTA, CONTACTADO, EN_SEGUIMIENTO, DESCARTADO` — estado de la gestión de contacto. **Se queda igual, no se toca.**
- **`score`** (Int) — scoring conductual. Se queda igual.
- Aparte: la **etapa del deal** (`Deal.stage`) — del negocio, no del contacto.

No existe ningún concepto "lifecycle" en schema ni código (verificado).

## 3. Decisiones (cerradas en brainstorming)

1. **Modelo:** *Formalizar* la progresión de `contactType` en un lifecycle real (no un eje paralelo suelto, no config-driven sin tipo).
2. **Etapas (set HubSpot completo, 7):** `SUSCRIPTOR → LEAD → MQL → SQL → OPORTUNIDAD → CLIENTE → EMBAJADOR`.
3. **Aplicabilidad:** el lifecycle aplica **solo a Comprador/Inversionista**. Para Broker y Empleo queda **nulo (N/A)** — no son embudo de compra.
4. **`contactType` → categoría pura:** valores nuevos `COMPRADOR, INVERSIONISTA, BROKER_EXTERNO, EMPLEO, REFERIDOR`. (`REFERIDO` se conserva como categoría `REFERIDOR`, NO se mueve a `leadSource`.)
5. **Transiciones híbridas:** auto-avance **solo hacia adelante** por reglas/eventos + **override manual** del asesor (puede mover a cualquier etapa, incl. atrás). El auto nunca retrocede.

## 4. Modelo de datos

### 4.1 Enum nuevo
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
Orden canónico expuesto como constante en código (`LIFECYCLE_ORDER: LifecycleStage[]`) para la lógica forward-only y la UI (índice de etapa). El enum de Postgres **no** garantiza orden semántico; el orden vive en la constante.

### 4.2 Campo nuevo en `Contact`
```prisma
lifecycleStage  LifecycleStage?   // nullable: solo COMPRADOR/INVERSIONISTA lo usan
```

### 4.3 `ContactType` repropuesto
Valores objetivo: `COMPRADOR, INVERSIONISTA, BROKER_EXTERNO, EMPLEO, REFERIDOR`.

**Migración aditiva en 2 pasos** (Postgres no permite borrar valores de enum en caliente, y borrar antes de que el código deje de referenciarlos rompe el cliente — ver `feedback_schema_sin_migracion_rompe_cliente`):

- **Paso 1 (este sub-proyecto):** `ALTER TYPE ContactType ADD VALUE` para `COMPRADOR` y `REFERIDOR` (los demás ya existen). Backfill de datos. El código deja de escribir `LEAD/PROSPECTO/CLIENTE` en `contactType`.
- **Paso 2 (sesión posterior, fuera de alcance):** retirar `LEAD/PROSPECTO/CLIENTE` del enum una vez que cero filas y cero código los usen. Documentado, NO se ejecuta ahora.

### 4.4 Historial de transiciones
Cada cambio de etapa (auto o manual) emite el evento de dominio `contact.lifecycle_changed` (el motor de workflows ya tiene bus de eventos) y escribe una `Activity` con `from`/`to`/`actor`. **Sin tabla nueva.** Esto deja el rastro para las métricas del componente F.

## 5. Transiciones (motor)

### 5.1 Reglas de auto-avance (forward-only)
El avance automático se dispara con eventos que el motor **ya emite**; la transición solo aplica si la etapa destino es **posterior** a la actual en `LIFECYCLE_ORDER` (o si la actual es `null` y el contacto es Comprador/Inversionista):

| Señal (evento existente) | → etapa |
|---|---|
| contacto respondió / `score ≥ ceil(umbral/2)` | **MQL** |
| calificado por ventas (`Deal`/contacto con `DISCOVERY_DONE` **o** `score ≥ umbral`) | **SQL** |
| deal abierto (deal creado / `deal.stage_changed` a etapa activa) | **OPORTUNIDAD** |
| deal ganado (`Deal.actualCloseDate` set / etapa ganada) | **CLIENTE** |

`umbral` = `SystemConfig` `capi.qualified_score_threshold` (reuso; default 70 si ausente). `SUSCRIPTOR` y `EMBAJADOR` no tienen auto-trigger en v1 (solo manual): SUSCRIPTOR es estado de entrada opt-in sin interés; EMBAJADOR es designación manual post-venta.

### 5.2 Override manual
El asesor cambia la etapa desde la UI a **cualquier** valor (incl. retroceder, p.ej. re-enganche de un cliente frío). El guard forward-only aplica **solo al auto**. Todo override manual queda en el historial (§4.4) con `actor = userId`.

### 5.3 Helper puro
`src/lib/lifecycle/transitions.ts` — funciones puras testeables: `stageIndex(stage)`, `isForward(from, to)`, `nextStageFor(signal, current, contact)`, `applyLifecycleTransition(...)` (decide + emite evento + escribe Activity). Cero I/O en las funciones de decisión (patrón del motor de workflows existente).

## 6. Integración con el builder de workflows (Fase 2)

El lifecycle se vuelve ciudadano de primera clase del builder:
- **Trigger nuevo `LIFECYCLE_CHANGE`** — con `fromStage`/`toStage` en `triggerConfig` (espejo exacto de `STAGE_CHANGE` del deal; aprovecha el modelo del builder y el fix `toStage` de Fase 2).
- **Condición:** `contact.lifecycleStage` agregado a `FIELD_SUGGESTIONS` del builder + al `buildContext` del engine (queda disponible en el DSL).
- **Acción nueva `SET_LIFECYCLE`** — setea la etapa (con guard forward-only salvo `allowBackward: true` explícito en la config de la acción). Validada contra el enum (igual que `UPDATE_FIELD`; ojo whitelist en `actions.ts`, ver lección Fase 2).

Resultado: Luis arma en el builder cosas como "lead respondió WhatsApp → SET_LIFECYCLE MQL → ENROLL_PLAN cadencia de nutrición".

## 7. UI

- **Stepper de etapas** en el detalle de contacto: barra horizontal con la etapa activa resaltada, etapas previas marcadas, click en una etapa = override manual con confirm. Composición con oficio (no un `<select>` genérico) — ver `feedback_ui_craft_no_admin_template`. Para contactos Broker/Empleo (lifecycle null) el stepper **no se muestra**.
- **Categoría** (`contactType`) se muestra como **chip aparte** del stepper (son ejes distintos).
- **Lista de contactos:** badge de etapa de lifecycle + **filtro** por `lifecycleStage` (junto al filtro de `contactStatus` existente).
- Colores de etapa: paleta de espectro funnel ya definida en `constants.ts` (`STAGE_COLORS`), extendida/mapeada a las 7 etapas. Coherente con el rediseño B/N (color solo en etiquetas de etapa).

## 8. Migración de datos existentes

Backfill idempotente en el SQL de migración, mapeo `contactType` viejo → (`lifecycleStage`, `contactType` nuevo):

| `contactType` viejo | `lifecycleStage` | `contactType` nuevo |
|---|---|---|
| LEAD | LEAD | COMPRADOR |
| PROSPECTO | SQL | COMPRADOR |
| CLIENTE | CLIENTE | COMPRADOR |
| INVERSIONISTA | CLIENTE si tiene deal ganado, si no LEAD | INVERSIONISTA |
| BROKER_EXTERNO | null | BROKER_EXTERNO |
| REFERIDO | null | REFERIDOR |
| EMPLEO | null | EMPLEO |

`lifecycleStage` se deriva del estado de deals donde aplique (deal ganado → CLIENTE) vía el backfill. Idempotente: re-correrlo no cambia filas ya migradas.

## 9. Gate de migración (infra compartida)

La BD `oaijxdpevakashxshhvm` es **compartida con producción**. El SQL de migración queda **preparado y verificado** en `prisma/migrations-manual/2026-06-23-lifecycle-stages.sql` pero **NO se aplica** sin la frase explícita de Luis (`"aplica la migración lifecycle"`), por `feedback_autorizacion_explicita_infra`. La migración es **aditiva** (ADD VALUE + ADD COLUMN nullable + backfill UPDATE) → cero riesgo de pérdida. `ALTER TYPE ... ADD VALUE` va en statements separados del resto (no puede correr en la misma transacción que su uso).

## 10. Testing

- **Unit (TDD):** `transitions.test.ts` — `stageIndex`, `isForward` (incl. null → primera etapa), `nextStageFor` por cada señal, guard forward-only (auto no retrocede; manual sí), umbral MQL=ceil(threshold/2) vs SQL=threshold.
- **Unit:** `actions.ts` — `SET_LIFECYCLE` respeta forward-only y `allowBackward`; validación de enum (incl. el whitelist runtime).
- **Unit:** builder-model — `LIFECYCLE_CHANGE` escribe `toStage`; `contact.lifecycleStage` en sugerencias.
- **Integración (mock):** evento `contact.lifecycle_changed` se emite y escribe Activity en una transición.
- **NO** E2E Playwright salvo que Luis lo pida (precedente Fase 2).

## 11. Alcance v1 (YAGNI)

- **SÍ:** enum `LifecycleStage` + `Contact.lifecycleStage` + `contactType` paso-1 + transiciones híbridas (helper + auto-rules + manual) + historial vía evento/Activity + integración builder (trigger/condición/acción) + UI (stepper/badge/filtro) + migración preparada.
- **NO (sub-proyectos propios):** métricas por etapa (componente F), mini-embudo de reclutamiento para Empleo (descartado), canvas de journey (componente C), paso-2 de limpieza del enum `ContactType`.

## 12. Riesgos / lecciones aplicadas

- **Doble enum (BD vs zod):** si algún schema zod valida `contactType`/lifecycle, agregar el valor en ambos lados (lección Fase 2 / `feedback_db_enum_vs_zod_enum`).
- **Whitelist runtime en `actions.ts`:** agregar `SET_LIFECYCLE` y el valor de etapa al whitelist, no solo al enum de Prisma (lección Fase 2).
- **Worktree compartido:** trabajo en worktree aislado; verificar autoría `Propyte-Luis` antes de push (`feedback_git_author_propyte_crm`), ff-merge a main.
