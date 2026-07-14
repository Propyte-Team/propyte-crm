# Bot: agentes por tipo de conversación (Frente 4 de 4)

**Fecha:** 2026-07-14 · **Aprobado por:** Luis (diseño + autorización nombrada de la migración) · Rama `feat/bot-agentes`.

## Decisiones de Luis
- El bot **clasifica y contesta a TODOS** los segmentos, usando los `ContactType` existentes del CRM (no se agregó PROVEEDOR — disponible como follow-up con `ALTER TYPE`).
- Cada segmento llena su propia información de forma autónoma (playbook por agente).

## Estado previo
Un solo playbook global (`BotConfig.activePlaybookId`); el bot jamás leía `contactType`; no existía clasificador. La captura autónoma auditada ya existía (playbook `apply.ts`, source `bot_playbook`).

## Diseño

### Infra (APLICADA 2026-07-14)
`prisma/migrations-manual/2026-07-14-bot-agentes.sql`: tabla `bot_agent_profiles` (name, `contactTypes ContactType[]`, identity, playbookId FK→bot_playbooks SET NULL, tonePreset?, isActive, priority) + `bot_config.classifyContacts` (default true) + **3 seeds INACTIVOS**: Agente Clientes (LEAD/PROSPECTO/COMPRADOR/CLIENTE/INVERSIONISTA), Agente Brokers (BROKER_EXTERNO/REFERIDOR), Agente Reclutamiento (EMPLEO).

### Clasificador — `src/lib/bot/classify.ts`
- `classifyContactType`: structured output (enum 6 clasificables + UNKNOWN), timeout 4s, nunca lanza (patrón de `extract.ts`).
- `maybeClassifyContact`: 1 clasificación por contacto (marker `custom.bot_classification {type, attempts, at}`, máx. 3 intentos); **solo pisa `contactType` si el valor actual es default del intake (COMPRADOR/LEAD)** — jamás sobrescribe valores humanos; escritura en transacción con `setChangeSource('bot_classifier')` (cronología) + `AuditLog`.

### Selección — `src/lib/bot/agent-profiles.ts`
`selectAgentProfile(db, contactType)`: perfil activo con `contactTypes has` el tipo, menor `priority` gana; playbook soft-borrado se anula (fallback al global). null = sin agente.

### Integración — `bot-respond.ts`
Tras armar el historial: si hay agentes activos (count>0) → clasificar (si `classifyContacts`) → seleccionar agente. Efectos:
- **Playbook**: el del agente manda; sin propio → el global activo (como hoy).
- **Objetivo**: `identidad del agente + (objective del playbook ?? fallback)` en la capa 3 del prompt.
- **Tono**: override del perfil sobre el global.
Todo best-effort: sin agentes activos o cualquier fallo → flujo idéntico al actual (cero regresión; sin agentes tampoco se gasta la llamada de clasificación).

### Admin — pestaña "Agentes del bot" (`/admin?tab=botAgents`)
`bot-agents-tab.tsx` + server actions `src/server/bot-agents.ts` (RBAC ADMIN/DIRECTOR/GERENTE, zod, AuditLog CREATE/UPDATE/DELETE, soft-delete): CRUD de perfiles con chips de segmentos, identidad, playbook, tono, prioridad y toggle activo. Card en Configuración → Bot conversacional.

## Verificación
TDD: classify (7), agent-profiles (3), bot-respond.agents (4) + regresiones. Gates: 817 tests, tsc limpio (2 preexistentes), build exit 0.

## Activación (Luis)
Configuración → Agentes del bot → activar los seeds (y opcionalmente asignarles playbooks propios). Smoke: escribir "busco trabajo" o "soy broker, traigo un cliente" por WhatsApp/DM → verificar contactType clasificado en la cronología + respuesta con la identidad del segmento.
