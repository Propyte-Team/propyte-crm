# Cronología por registro + field changes (2026-07-13)

**Pedido (Luis, con screenshots de Zoho como referencia):**
1. Log por contacto de transiciones del estado de seguimiento con hora y duración en cada estado.
2. Cronología por contacto con TODO cambio desde su registro (campos, cadencias, correos, mensajes, tareas) — como la pestaña "Cronología" de Zoho.
3. Tabla en Supabase con toda la cronología de todos los campos, cosa por cosa.

**Decisiones cerradas con Luis:**
- Escalera de estados = la de Zoho: Nuevo, Sin respuesta, Contactado, Contactado perdido, Reunión, Prospecto, Perdido. **Aditivo**: se agregan `PERDIDO, CONTACTADO_PERDIDO, REUNION, PROSPECTO` al enum `ContactStatus`; `EN_SEGUIMIENTO`/`DESCARTADO` quedan como legacy (sin migración de datos).
- Alcance de captura: **contacts Y deals**, cada uno con su ciclo (contactStatus / stage).
- UI: sección **"Cronología"** nueva en el detalle de contacto (el ActivityLog existente se queda).

## Arquitectura

**Captura — trigger de Postgres (no capa app):** hay ~14 caminos que escriben `contacts` (UI, workflows, bot, intake, routing, merge, zapier, scripts) y solo 1 auditaba por campo. Un trigger `AFTER UPDATE` en `contacts` y `deals` compara `to_jsonb(OLD)` vs `to_jsonb(NEW)` key por key (excluye `updatedAt`, `lastActivityAt`) e inserta en `propyte_crm.record_field_changes` (jsonb old/new, RLS habilitada). Atrapa TODO escritor, presente y futuro.

**Atribución — GUC transaccional:** el trigger lee `current_setting('crm.source'/'crm.actor_id', true)`. La app los fija con `set_config(..., true)` (transaction-local → seguro con pgbouncer/transaction pooler) vía `withChangeSource()`/`setChangeSource()` (`src/lib/audit/change-context.ts`) en 10 call sites: contacts PUT/DELETE (`ui`), UPDATE_FIELD/ADD_TAG (`workflow[:ruleId]`), bot playbook (`bot_playbook`), routing (`routing`), merge (`merge`), zapier (`zapier`), custom fields (`ui`), deal stage (`ui`). Escritores no envueltos → source NULL = "Sistema" (el cambio igual queda).

**Duraciones:** vistas SQL `v_contact_status_periods` / `v_deal_stage_periods` (LEAD por entidad + período inicial desde `createdAt` con el old del primer cambio + fallback para registros sin cambios; `exited_at NULL` = vigente) — consultables directo en Supabase (req. 3). La API calcula lo mismo en TS (`computeStatusPeriods`) para no depender de la vista.

**Timeline API:** `GET /api/contacts/[id]/timeline` fusiona RecordFieldChange + Activity (correos/tareas/llamadas/notas) + Message (WhatsApp/IG/MSG) + ActionPlanEnrollment (inscripción/salida de cadencias) + "Contacto creado"; merge-sort desc con cursor `before`. `GET /api/contacts/[id]/status-periods` para el bloque de duraciones. **Defensivo pre-migración:** queries a `record_field_changes` en try/catch → `fieldChangesAvailable:false` y el timeline sigue con el resto.

**Migración** `prisma/migrations-manual/2026-07-13-cronologia-field-changes.sql` — 2 envíos (enum fuera de transacción), aditiva e idempotente. Orden de despliegue: **migración → deploy** (el código degrada si falta la tabla, pero el enum nuevo debe existir antes de que la UI escriba los estados nuevos).

## Deuda conocida / follow-ups
- UI de cronología/duraciones para **deals** (los datos ya se capturan; falta superficie en el detalle del deal).
- `custom` (Json) se loguea como valor completo old/new, no por sub-key.
- Backfill histórico imposible para cambios de campo (no existía captura); Activities/Messages/Enrollments sí aparecen retroactivos en el timeline.
- Fuentes sin envolver (seeds/scripts/otros endpoints) quedan como "Sistema".
