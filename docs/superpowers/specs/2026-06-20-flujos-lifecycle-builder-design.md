# Flujos de Trabajo & SLA — Builder de Ciclo de Vida (tipo HubSpot) — Diseño

**Fecha:** 2026-06-20
**Proyecto:** Propyte CRM (`propyte-crm`)
**Estado:** Borrador para revisión de Luis. (Fase 1 / Fundación YA desplegada — ver §3.)

## 1. Visión

Construir en el CRM la capacidad de **automatizar todo el ciclo de vida del cliente** de forma
visual, al nivel de HubSpot/Zoho: desde que entra un lead (por campaña/formulario/plataforma),
diferenciarlo por segmento (Lead / Broker / Empleo / etc.), rutearlo, aplicarle SLA, cadencias,
cambios de etapa, tareas, mensajes y reglas — **sin tocar código**, desde un editor.

Referencia concreta que dio Luis: su **flujo de Zoho** (5 condiciones que branchean por
`Nombre de Campaña CONTIENE [BROKER]/[EMPLEO]/...` → setean Tipo de Contacto, Fuente, etapa,
propietario, plataforma, tags, y acciones programadas a +10 min). Objetivo final: un **canvas de
journey** donde se arme literalmente todo el ciclo del cliente.

## 2. Principio rector

El CRM mantiene **una taxonomía canónica** (enums de tipo/fuente/etapa) y la diferenciación de
segmentos vive en **reglas configurables** (no hardcode en conectores). Las señales crudas
(campaña, formulario, plataforma, respuestas) se **capturan** en el lead; las **reglas** deciden
qué hacer. Esto escala a cualquier plataforma (Meta ES/EN, TikTok, Google, LinkedIn) y formulario.

## 3. Estado actual (lo que YA existe)

Motor de workflows sólido (ver auditoría 2026-06-20):
- **Triggers:** EVENT, TIME, BEHAVIORAL, INACTIVITY, STAGE_CHANGE, SLA_BREACH, SCORE_THRESHOLD.
  Eventos de dominio: `contact.created`, `lead.captured`, `deal.stage_changed`, `sla.breach`, etc.
- **Condiciones:** DSL `all`/`any` anidable, 11 operadores (`eq/neq/gt/gte/lt/lte/in/nin/contains/exists/changed_to`), dot-path.
- **Acciones (16):** CREATE_TASK, SEND_WHATSAPP, ASSIGN/REASSIGN, NOTIFY, UPDATE_FIELD, ADD_TAG,
  CHANGE_STAGE, ENROLL_PLAN (cadencia), ESCALATE, AI_DRAFT/REPLY/CALL_SUMMARY, WEBHOOK, GW_GMAIL_*.
  (SEND_EMAIL y MAKE_CALL son stubs.)
- **Cadencias** (ActionPlan multi-paso con `delayMinutes`, condiciones por paso, autonomy level).
- **Routing** por RoutingRule (round-robin / performance / guardia / territorio).
- **SLA** (first-touch / retry / orphan) con escalation chain y business hours por plaza.
- **Builder visual** en `/configuracion` (multi-condición, multi-acción, 7 triggers).

### Fase 1 / Fundación — DESPLEGADA (commit `35b9053`)
- El conector Meta ahora **captura `campaignName`/`adName`/`adsetName`/`network`** en `AdAttribution`
  (antes se perdían en un string) + `form_id` en `Contact.custom`.
- El motor de reglas y el routing **exponen `adAttribution`** en el contexto del DSL → una regla
  puede condicionar por `adAttribution.campaignName contains "BROKER"`.
- `UPDATE_FIELD` ahora puede setear `contactType` y `leadSource` (validado contra enums).
- **Resultado:** YA se pueden armar reglas Lead/Broker (campaña→tipo/fuente/asignación/tags) en el
  builder actual. (Probado con tests de segmentación.)

## 4. Brechas restantes (de la auditoría)

| # | Brecha | Fase |
|---|---|---|
| Bug | Trigger STAGE_CHANGE: el builder escribe `{stage}` pero el motor lee `{toStage}` → no dispara | 2 |
| UI | `delayMinutes` por acción no expuesto en el builder (el motor sí lo soporta) | 2 |
| UI | Faltan `contactType`/`leadSource`/`adAttribution.*` en el selector de campos del builder | 2 |
| UI | Condiciones anidadas (`all` dentro de `any`) no armables en UI (motor sí soporta) | 2 |
| Data | `ContactType` no tiene valor para "Empleo/Candidato" (Zoho los separa) — decidir enum vs tag | 2 |
| Func | Routing/SLA por segmento de campaña (motor: falta selección de SlaPolicy por segmento) | 2/3 |
| UI | Cadencias (ActionPlan) sin editor visual | 3 |
| Func | SEND_EMAIL y MAKE_CALL son stubs | 3 |
| UI | Canvas visual de journey (vista de ciclo de vida tipo HubSpot) | 3 |

## 5. Diseño por fases

### Fase 2 — Builder a nivel Zoho (segmentación completa en UI)
Meta: que Luis arme en el editor todo lo que hoy hace en Zoho, sin tocar BD.
1. **Fix STAGE_CHANGE** (`workflow-builder.tsx` escribe `toStage`).
2. **`delayMinutes` por acción** en el builder (acciones diferidas: "WhatsApp a +10 min").
3. **Selector de campos enriquecido:** agregar `contact.contactType`, `contact.leadSource`,
   `adAttribution.campaignName/adName/network`, `contact.custom.*` (form), a las sugerencias.
4. **Condiciones anidadas** (grupos `all`/`any`) en UI.
5. **Empleo/Candidato:** decidir (OQ1) — agregar `ContactType.EMPLEO`/`CANDIDATO` (migración aditiva)
   o manejarlo por tag + asignación. Si enum: lo agrega `UPDATE_FIELD`.
6. **Plantillas de regla** ("recetas"): pre-armar las reglas Lead/Broker/Empleo por campaña como
   plantillas que Luis active/edite (acelera el setup, evita armar de cero).

### Fase 3 — Canvas de Ciclo de Vida (tipo HubSpot)
Meta: armar visualmente el journey completo, no solo reglas sueltas.
1. **Editor de cadencias (ActionPlan)** visual: pasos con delays, condiciones de salida, ramas.
2. **Canvas de journey**: nodos (trigger → condición → acción/espera → rama) conectables, vista de
   todo el flujo (lo que hace HubSpot). Reusa el motor (AutomationRule + ActionPlan) como backend;
   el canvas es una capa de orquestación visual.
3. **SLA por segmento:** seleccionar `SlaPolicy` por `contactType`/campaña/plaza (no solo default).
4. **SEND_EMAIL en vivo** (ya hay Gmail GW-1) + **MAKE_CALL** (Twilio ya integrado).
5. **Lifecycle stages** explícitas del contacto (no solo etapas del deal) para journeys completos.
6. **Métricas del flujo:** cuántos entraron/avanzaron/convirtieron por nodo (analítica del journey).

## 6. Modelo de datos

**Reusa:** `AutomationRule`, `WorkflowEvent`, `ActionPlan(+Step+Enrollment)`, `RoutingRule`,
`SlaPolicy`, `SlaTimer`, `AdAttribution`. La mayoría del backend ya existe.

**Posibles adiciones (a confirmar en cada fase):**
- `ContactType += EMPLEO/CANDIDATO` (si OQ1 = enum). Aditivo.
- Modelo `Journey`/`JourneyNode` para el canvas de Fase 3 (o representar el journey como un grafo
  serializado sobre AutomationRule/ActionPlan — decisión de arquitectura de Fase 3, OQ4).
- `SlaPolicy.conditions` (JSON) para selección por segmento (Fase 3).

## 7. Preguntas abiertas (para Luis)

- **OQ1 — Empleo/Candidato:** ¿`ContactType` nuevo (EMPLEO/CANDIDATO) o manejarlo por tag +
  asignación a reclutador? (Zoho usa tipo Empleo + campo Candidato.)
- **OQ2 — Segmentación primaria:** ¿branchear por **campaña** (recomendado, ya capturado) o también
  por **nombre de formulario**? (El form_name requeriría un fetch extra a Meta; el form_id ya queda
  en custom. La campaña ya trae [BROKER]/[LEADS]/[EMPLEO].)
- **OQ3 — Alcance del canvas (Fase 3):** ¿journey lineal con ramas (como Zoho/cadencias) o canvas
  libre tipo HubSpot Workflows (multi-rama, esperas, goals)? Define el esfuerzo.
- **OQ4 — Arquitectura del canvas:** ¿modelo `Journey` nuevo, o componer sobre AutomationRule +
  ActionPlan existentes con una capa visual? (Prefiero reusar para no duplicar motor.)
- **OQ5 — Lifecycle stages:** ¿se necesitan etapas de ciclo de vida del **contacto** (Suscriptor →
  Lead → MQL → SQL → Cliente) además de las etapas del **deal**? (HubSpot las separa.)

## 8. Plan de fases (resumen)

1. **Fase 1 — Fundación** ✅ DESPLEGADA (`35b9053`).
2. **Fase 2 — Builder Zoho-parity** (fix STAGE_CHANGE, delays UI, campos, anidación, Empleo,
   plantillas de regla). Entrega: Luis arma toda su segmentación en UI.
3. **Fase 3 — Canvas de ciclo de vida** (cadencias UI, canvas journey, SLA por segmento,
   email/llamada en vivo, lifecycle stages, métricas). Entrega: builder tipo HubSpot.

Cada fase = su propio plan de implementación (subagent-driven, TDD, review, deploy).
