# Conectividad, Agentes & CAPI — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Fases C1→C3 en orden.

**Goal:** Implementar Speckit #4: generalizar el framework de conectores (portales/TikTok/LinkedIn),
gateway de Conversions API multi-plataforma (devolver eventos del pipeline con calidad del lead),
y capa de agentes IA gobernados (agente = User con RBAC + herramientas + auditoría).

**Architecture:** REUSAR lo construido: `LeadConnector`/`ConnectorLeadLog` (F1/F3) ES el connector
registry — se extiende con providers/dirección, no se duplica. CAPI = `ConversionEvent` (log outbound,
idempotente por eventId) + adaptadores por plataforma + dispatcher en el cron del motor. Agentes =
`AgentDef` (identidad systemUserId) + `AgentRun` (pasos auditables) + registry de tools internas
tipadas con RBAC (base del futuro MCP) + runner Claude tool-use con guardarraíles heredados.

**Aprobación:** Luis 2026-06-11 ("dale con este").

## Decisiones (cierran §9 Open Questions)

| OQ | Decisión |
|---|---|
| 1 Sender único | **CRM = dueño de eventos comerciales** (CAPI Qualified/Reserved/Won). Hub = ingesta de ads/spend (sin cambios). El evento `Lead` solo lo manda el CRM con `event_id` determinista para dedup vs pixel. |
| 2 Agregador portales | EasyBroker/Proppit entran como **conectores WEBHOOK** (configuración, no código). Feeds uno-a-uno = después. La sindicación de catálogo (OUT) es del Hub (PA6) — fuera de este repo. |
| 3 Autonomía v1 | Modelo soporta **L3** pero los agentes sembrados arrancan **L2**; subir a L3 = editar `autonomyLevel` con métricas de `agent_runs`. |
| 4 MCP externo | **Solo agentes internos v1.** El registry de tools tipadas (`lib/agents/tools.ts`) es la superficie que después se expone vía MCP server — diseñado para ese swap. |
| 5 LinkedIn | **Diferido.** El modelo lo soporta (provider LINKEDIN, liFatId, adapter stub estructurado); activarlo es config + completar adapter. |
| 6 PII | SHA-256 con normalización (email lowercase/trim; phone E.164 sin "+"; nombres lowercase sin acentos). Nunca se envía si `doNotContact`. `action_source=system_generated`. |
| 7 Umbral Qualified | Etapa ≥ `DISCOVERY_DONE` **o** `score ≥ 70` (configurable: SystemConfig `capi.qualified_score_threshold`). |

## Fases

### C1 — Framework generalizado (extiende F3)
- Enum `ConnectorProvider` += GOOGLE, LINKEDIN, INMUEBLES24, LAMUDI_PROPPIT, PROPIEDADES, VIVANUNCIOS, EASYBROKER, CUSTOM.
- `LeadConnector.direction` (INBOUND/OUTBOUND/BOTH) — los OUTBOUND guardan credenciales CAPI (pixelId+token).
- `AdAttribution` += `ttclid`, `liFatId`, `portalLeadId`. `incomingLeadSchema` += ttclid/liFatId/portalLeadId.
- Webhook genérico de portales: `/api/connectors/portal/webhook?cid=<connectorId>` (HMAC opcional por secret del conector) → processIncomingLead.

### C2 — Gateway CAPI
- Modelo `ConversionEvent` (eventId UNIQUE = idempotencia; clickIds; hashedPII; platforms; attempts/backoff; emq).
- `lib/capi/hash.ts` (TDD) · `lib/capi/events.ts` (recordConversionEvent + mapping §5.2 desde stage) ·
  `lib/capi/adapters/{meta,tiktok,google,linkedin}.ts` (Meta+TikTok reales; Google/LinkedIn stubs estructurados) ·
  `lib/capi/dispatch.ts` (cola + reintentos).
- Wiring: captureLead→`Lead`; transitionDealStage→`Qualified|MeetingScheduled|Reserved|Won` (+value).
- Dispatcher en el tick `/api/cron/workflows` (guarda defensiva pre-migración).

### C3 — Capa de agentes
- Modelos `AgentDef` (systemUserId=identidad RBAC, allowedTools, autonomyLevel, limits) + `AgentRun` (steps auditables).
- `lib/agents/tools.ts`: registry tipado (search_contacts, get_contact, update_profile, score_contact,
  match_units, send_whatsapp, create_task, advance_stage…) — cada tool valida rol del systemUser + opt-out.
- `lib/agents/runner.ts`: loop Claude tool-use (máx 8 pasos), brand linter en salidas, escalado a humano,
  todo paso → AgentRun.steps + Activity/AuditLog.
- API `/api/admin/agents` (CRUD) + `/api/agents/[id]/run` (trigger manual/programático).
- Seeds: agentes **SDR Speed-to-lead** y **Calificador** (L2, herramientas acotadas) — INACTIVOS hasta activar.
- Agent Studio UI completo = siguiente sesión (APIs listas).

### Fuera de alcance (documentado)
C4 sindicación portales (repo Hub) · A2A · MCP server expuesto · LinkedIn activo · Agent Studio visual.
