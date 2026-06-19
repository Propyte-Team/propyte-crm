# Propyte CRM — MCP Admin Server (diseño)

**Fecha:** 2026-06-19
**Autor:** Luis Flores + Claude
**Estado:** Aprobado para planificación

## Objetivo

Un servidor MCP que permita operar el Propyte CRM con poder de Administrador desde
lenguaje natural: crear flujos de contacto/automatizaciones, gestionar conexiones y
webhooks, configurar equipos/territorios/campos/agentes, y operar datos
(contactos/deals/cotizaciones) — sin pasar por la UI.

Caso estrella: *"crea un flujo de contacto que haga X"* → el MCP traduce esa
intención al DSL data-driven del motor de workflows del CRM y lo deja creado.

## Decisiones (cerradas con el usuario)

1. **Arquitectura:** MCP stdio → REST del CRM. Mismo patrón que `propyte-hub-mcp`.
2. **Alcance v1:** TODO (flujos, conexiones/webhooks, configuración, datos),
   entregado por fases.
3. **Permisos de escritura:** read + create/update. **Cero DELETE destructivo**;
   las operaciones reversibles (desactivar regla, pausar conector, archivar campo)
   reemplazan al borrado.
4. **Bootstrap de auth:** un único env `CRM_MCP_API_TOKEN` validado en el route
   (patrón del Hub), no el CRUD completo de la tabla `ApiKey`.

## Contexto del CRM relevante

- **No existe `/api/mcp`** en el CRM hoy. Hay que crearlo (paralelo al del Hub).
- Capa reutilizable: `src/lib/agents/tools.ts` — comentario literal *"base del
  futuro MCP"*, con 8 tools con guardarraíles (search_contacts, get_contact,
  update_investment_profile, match_units, send_whatsapp, create_task,
  escalate_to_human, capture_lead).
- Endpoints admin ya existentes: `/api/admin/automation`,
  `/api/admin/automation/rules`, `/api/admin/automation/retry`,
  `/api/admin/connectors[/:id]`, `/api/admin/teams[/:id]`,
  `/api/admin/territories`, `/api/admin/metadata/fields`,
  `/api/admin/metadata/core-fields`, `/api/admin/relationships`,
  `/api/admin/agents[/:id]`.
- Auth actual: NextAuth session en rutas admin; `x-cron-secret` en cron; API Key
  Bearer (`pk_live_`) existe pero solo la usa Zapier.
- RBAC: `VIEWER(0) < SDR(1) < SALES_REP(2) < CLOSER(3) < MARKETING(4) <
  TEAM_LEAD(5) < MANAGER(6) < ADMIN(7) < SUPER_ADMIN(8)`.

### Motor de flujos (data-driven)

- `WorkflowEvent` (log append-only): type, entityType, entityId, payload, occurredAt.
- `AutomationRule`: name(unique), isActive, priority, triggerType (`TriggerType`:
  EVENT | TIME | BEHAVIORAL | INACTIVITY | STAGE_CHANGE | SLA_BREACH |
  SCORE_THRESHOLD), triggerConfig(Json), conditions(Json DSL), actions(Json
  `ActionSpec[]` = `[{type, config}]`), cooldownMinutes, lastFiredAt.
- `ActionPlan` + `ActionPlanStep` (order, delayMinutes, actionType, config,
  conditions, autonomyLevel L0/L1/L2) + `ActionPlanEnrollment`.
- `ActionQueue`: dedupeKey(unique), status (PENDING|RUNNING|DONE|FAILED|SKIPPED),
  attempts/maxAttempts, runAfter, error.
- `RoutingRule`: name(unique), priority, isActive, conditions(Json),
  strategy (`LeadAssignmentMode`: ROUND_ROBIN|PERFORMANCE|MANUAL|GUARDIA),
  targets(Json {userIds, roles, weights}).
- `SlaPolicy`: firstTouchMinutes, retryMinutes, orphanHours, escalationChain(Json),
  businessHours(Json), channelFallback(Json).
- `WorkflowActionType`: CREATE_TASK | SEND_WHATSAPP | SEND_EMAIL | MAKE_CALL |
  ASSIGN | REASSIGN | NOTIFY | UPDATE_FIELD | ADD_TAG | CHANGE_STAGE |
  ENROLL_PLAN | ESCALATE | AI_DRAFT | AI_REPLY | AI_CALL_SUMMARY | WEBHOOK |
  GW_GMAIL_LOG_INBOUND | GW_GMAIL_LOG_OUTBOUND.
- Tick del motor: cron `/api/cron/workflows` (cada 1 min):
  processPendingEvents → runQueue → checkSlaBreaches → runEnrollments.

### Conectores

- `LeadConnector`: name, provider (`ConnectorProvider`: META|INSTAGRAM|MESSENGER|
  TIKTOK|WEBSITE|ZAPIER|MANUAL|GOOGLE|LINKEDIN|INMUEBLES24|LAMUDI_PROPPIT|
  PROPIEDADES|VIVANUNCIOS|EASYBROKER|CUSTOM), direction (INBOUND; outbound no
  modelado), status (ACTIVE|PAUSED|ERROR), credentials (JSON cifrado AES-256-GCM),
  config(Json), fieldMap(Json), lastLeadAt, errorCount.
- **No hay modelo de webhook saliente configurable.** La salida tipo webhook se
  hace con `WorkflowActionType.WEBHOOK` (URL+headers libres) dentro de una regla o
  paso de plan. Se documenta como la vía soportada.

## Arquitectura

Dos piezas, espejo de `propyte-hub-mcp`:

### A. Lado CRM — `src/app/api/mcp/[...path]/route.ts`

- Dynamic route que autentica Bearer contra `CRM_MCP_API_TOKEN`.
- Resuelve un **usuario-sistema SUPER_ADMIN** (existente o seed
  `mcp@propyte.local`, sin login interactivo) para pasar a la capa server.
- **Despacha a la capa server directamente** (`src/server/*`,
  `src/lib/workflows/*`, `src/lib/agents/tools.ts`), no re-pega a los endpoints
  con session. Una sola superficie de auth.
- Toda mutación → `AuditLog` con actor = usuario-sistema MCP y `source='mcp'`.
- Middleware: NUNCA expone DELETE. Operaciones reversibles sustituyen al borrado.

### B. Repo `propyte-crm-mcp` (stdio wrapper)

- Clon estructural de `propyte-hub-mcp`: `@modelcontextprotocol/sdk`, zod,
  `StdioServerTransport`.
- Env: `PROPYTE_CRM_URL` (default `https://crm.propyte.com`) + `CRM_MCP_API_TOKEN`.
- `CrmClient.request(method, path, body)` con `Authorization: Bearer`.
- Registro `ALL_TOOLS` = `{ name, description, inputSchema, handler }`.
- Registrado vía `claude mcp add -s user propyte-crm -- node .../dist/index.js`.
- Cuidado conocido: token con `\n` trailing rompe Bearer (Trim()).

## Catálogo de tools (read + create/update, sin DELETE)

### Introspección
- `crm_health` — estado, env, conexión DB.
- `describe_schema` — enums vivos: TriggerType, WorkflowActionType, forma del DSL
  de condiciones (ConditionGroup), LeadAssignmentMode, ConnectorProvider, tipos de
  campo custom, roles RBAC. **Crítico** para traducir NL → DSL sin inventar.
- `list_users`, `list_teams` — para resolver assignees/targets.

### Flujos / automatizaciones (F1)
- `list_automation_rules`, `get_automation_rule`
- `create_automation_rule`, `update_automation_rule` (incluye toggle `isActive`)
- `list_action_plans`, `get_action_plan`, `create_action_plan` (con steps),
  `update_action_plan`
- `list_routing_rules`, `create_routing_rule`, `update_routing_rule`
- `list_sla_policies`, `create_sla_policy`, `update_sla_policy`
- `list_action_queue`, `retry_action`

### Conexiones / webhooks (F2)
- `list_connectors`, `get_connector`, `create_connector`, `update_connector`
  (status/credentials/config/fieldMap; pausar ≠ borrar)
- (Webhook saliente: documentado como acción `WEBHOOK` dentro de un flujo)

### Configuración (F3)
- `list_teams`, `create_team`, `update_team`
- `list_territories`, `create_territory`, `update_territory`
- `list_custom_fields`, `create_custom_field`, `update_custom_field` (archivar ≠ borrar)
- `list_agents`, `get_agent`, `create_agent`, `update_agent` (toggle active)
- `list_relationships`, `create_relationship`

### Datos (F4)
- `search_contacts`, `get_contact`, `create_contact`, `update_contact`
- `list_deals`, `get_deal`, `create_deal`, `update_deal`
- `list_quotes`, `get_quote`, `create_quote`, `update_quote`
- Reusar de `agents/tools.ts`: `capture_lead`, `match_units`, `send_whatsapp`,
  `create_task` (heredan guardarraíles: doNotContact, brand-linter, data-gate).

## Flujo de datos (caso estrella)

1. Usuario: *"crea un flujo: cuando entre un lead de Meta en TULUM, asígnalo por
   round-robin al equipo TULUM y mándale WhatsApp de bienvenida; si nadie contesta
   en 5 min, escala al gerente."*
2. Claude llama `describe_schema` + `list_teams`/`list_users` para resolver enums e IDs.
3. Claude compone el `AutomationRule` (triggerType=EVENT `lead.captured`,
   conditions plaza=TULUM & source=META, actions=[ASSIGN round-robin, SEND_WHATSAPP])
   + posible `SlaPolicy`/regla SLA_BREACH para el escalamiento.
4. `create_automation_rule` (y SLA) → CRM valida con zod, persiste, AuditLog.
5. Se crea `isActive=false` por defecto; un `update_automation_rule` lo activa tras
   revisión. El cron del motor lo ejecuta en el siguiente tick.

## Manejo de errores

- CRM responde JSON `{ ok, data | error }`. El wrapper lanza `Error(error)` si !ok;
  CallTool envuelve en `{ isError: true }`.
- Validación zod en ambos lados (wrapper + route). Mensajes de zod se propagan.
- Idempotencia: las reglas/planes/conectores usan `name @unique` → create con
  nombre existente devuelve error claro (no duplica).

## Seguridad

- Cero tools DELETE. Todo lo "destructivo" se modela como reversible.
- Toda mutación → AuditLog (actor MCP, source='mcp').
- Token tipo SUPER_ADMIN; el env `CRM_MCP_API_TOKEN` vive solo en local del usuario
  y en Hostinger; nunca se commitea.
- Guardarraíles heredados de `agents/tools.ts` para envíos (doNotContact,
  whatsappOptOut, lintBrandVoice, data-gate de precios del Hub).
- Reglas nuevas nacen `isActive=false` (activación explícita).

## Testing

- Wrapper: smoke E2E contra crm.propyte.com (`crm_health` + un `list_*` + un
  create de prueba en regla inactiva, luego cleanup vía update).
- CRM route: tests de auth (token inválido → 401), de despacho por path, y de que
  no exista ninguna ruta DELETE.
- Caso estrella: test que componga una AutomationRule completa y verifique que el
  motor la encola en el siguiente tick (sin enviar WhatsApp real — modo dry).

## Entrega por fases

- **F0** — route `/api/mcp` + Bearer + AuditLog + usuario-sistema; scaffold del
  repo `propyte-crm-mcp` + tools de introspección. Smoke E2E.
- **F1 (estrella)** — Flujos: automation rules, action plans, routing, SLA.
- **F2** — Conexiones/webhooks.
- **F3** — Configuración: teams, territorios, campos custom, agentes, relaciones.
- **F4** — Datos: contactos, deals, cotizaciones + reuse de `agents/tools.ts`.

## Fuera de alcance (v1)

- CRUD completo de tabla `ApiKey` (se usa el env único).
- Modelo de webhook saliente configurable por UI (se usa la acción WEBHOOK).
- Tools DELETE de cualquier tipo.
- Superficie MCP pública/remota (solo stdio local del usuario).
