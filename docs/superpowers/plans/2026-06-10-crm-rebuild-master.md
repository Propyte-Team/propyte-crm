# Propyte CRM Rebuild — Plan Maestro por Fases

> **For agentic workers:** Cada fase tiene (o tendrá) su plan detallado en esta carpeta. Ejecutar
> con superpowers:executing-plans (inline) o superpowers:subagent-driven-development.

**Goal:** Implementar el SPECKIT consolidado + Anexo Técnico + Anexo B (conectores Meta/TikTok,
inbox WhatsApp con takeover, perfiles de usuario) sobre la base propyte-crm limpia.

**Architecture:** Schema-first (todas las entidades nuevas en una migración additiva), luego el
motor de workflows (corazón de automatización), luego intake multicanal, inbox, perfiles. El
inventario contra el Hub queda al final porque depende de T5.1 (repo Propyte_hub).

**Tech Stack:** Next.js 14 · Prisma 6 (multiSchema `propyte_crm`) · Supabase Postgres compartida ·
Twilio (WhatsApp) · Claude API (bot) · nodemailer/SMTP Hostinger · cron Hostinger (sin servicios nuevos).

**Aprobación:** Luis 2026-06-10 — "Apruebo el speckit que vayas a sacar, confío en que continúes".

---

## Fases

| # | Fase | Alcance | Specs | Depende de | Plan detallado |
|---|---|---|---|---|---|
| 1 | **Fundaciones de datos** | Todos los enums/modelos nuevos (Anexo §B.2-B.5, §D.2, §H, §I, §J) + migración SQL additiva + `lib/phone` E.164 + `lib/crypto` AES-GCM + validaciones zod + seeds canónicos | Anexo §A-B, §D.2-D.3, Anexo B | — | `2026-06-10-fase1-fundaciones.md` |
| 2 | **Motor de workflows** | emitEvent, RuleEngine (DSL §D.4), ActionQueue+Runner, SlaEngine, RoutingEngine, ActionPlanScheduler, 8 workflows canónicos activables, UI admin reglas | Anexo §C.5, §D | F1 | (siguiente sesión) |
| 3 | **Intake multicanal** | captureLead+dedupe (E.164/email), webhook web v2, conector Meta (webhook leadgen), conector TikTok (pull 5min), UI conectores en /admin, cola de merge humano | Anexo §C.1, Anexo B §H | F1, F2 (ruteo/SLA) | (siguiente sesión) |
| 4 | **Inbox WhatsApp + bot takeover** | conversations, inbound Twilio→conversación, botRespond (Claude+RAG Hub+guardarraíles), takeover/release, UI /inbox 3 paneles | Anexo B §I, consolidado §6.1 | F1; F3 para captura de desconocidos | (siguiente sesión) |
| 5 | **Perfiles de usuario** | user_profiles, plantillas con variables, firma/From alias, tarjeta digital /t/[slug] + QR + vCard, cadencias personales, /settings | Anexo B §J | F1; F2 para cadencias | (siguiente sesión) |
| 6 | **Cotizador + pagos + KYC UI** | Quote, PaymentPlan/Schedule, DealDocument, ExternalBroker, dossier UI, cobranza | Consolidado §2.3 (4-8), Anexo §C.2 | F1 | (siguiente sesión) |
| 7 | **Inventario Hub** | HubCatalog interface (SQL directo→API), hold/confirm/release, webhooks unit.status_changed, matching invertido, RESERVED gate | Anexo §E | **T5.1 en repo Propyte_hub** | (requiere trabajo en Hub) |

## Reglas transversales de ejecución
- **Migraciones:** SIEMPRE additivas; el SQL se genera con `prisma migrate diff` entre el schema
  de git HEAD y el nuevo, se revisa a mano (cero DROP/ALTER destructivo) y queda versionado en
  `prisma/migrations-manual/`. Se aplica con `prisma db execute`.
- **No tocar:** modelos `Development`/`Unit` locales (los retira la Fase 7 con el Hub listo),
  tablas históricas (`meta_leads`, `intake_*`).
- **TDD donde hay lógica:** utils (phone/crypto/DSL/render de plantillas) con vitest. Schema/UI
  se verifican con `prisma validate` + `tsc` + build + Playwright.
- **UI nueva:** estilo minimalista B/N (tokens de `globals.css`); color solo en etiquetas con significado.
- **Commits frecuentes** en rama `feat/crm-rebuild-fase1` (apilada sobre `feat/audit-fixes-minimal-ui`).

## Decisiones ya tomadas (no reabrir)
Ver Anexo B §K: AdAttribution en CRM · catálogo vía interfaz `HubCatalog` (SQL→API swap) ·
TTL hold 72h configurable · KYC cifrado app-level · runner = tabla `action_queue` + cron + API route ·
merge con confirmación humana (auto solo phone+email idénticos) · businessHours por plaza.
