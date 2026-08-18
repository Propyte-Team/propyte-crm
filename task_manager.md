# Task Manager — propyte-crm (núcleo CRM + Google Workspace)

> Última actualización: 2026-08-18 (moderador de permisos fase 0 en prod · blindaje de ADMIN · propietario).
>
> ## 🔐 Sesión 2026-08-17/18 — Moderador de permisos (main = `a02fce7e`)
>
> **En producción:** PR #12 (MARKETING gestiona comentarios sin ser ADMIN, en uso real) · PR #13 (botón de llave para restablecer contraseñas) · PR #14 (fase 0 del moderador, **sin consumidores a propósito**) · PR #15 (blindaje de ADMIN + propietario) · PR #16 (`config.actividad`→`config.sistema`) · PR #17 (inventario de la fase 1).
>
> **Pendientes que dependen de Luis:**
> - [ ] **Cambiar la contraseña de Felipe** (`fluksic@propyte.com`). Estaba en texto plano en la descripción del PR #6 de `Propyte_hub`; ya la retiré de ahí, **pero GitHub conserva el historial de ediciones**, así que sigue siendo recuperable. Se cambia desde `/admin` del CRM (botón de llave) — y como el Hub lee la misma tabla, queda cambiada en los dos sitios.
> - [x] **PR #6 de `Propyte_hub` CERRADO** (2026-08-18) sin mergear — password recovery + magic link. El reset manual desde /admin del CRM ya cubre la necesidad (misma tabla de usuarios). Rama `feat/auth-recovery-magic-link` intacta en GitHub.
>
> **Pendientes técnicos (ninguno urgente):**
> - [ ] **Sembrar los 17 permisos** (`npm run seed:permissions`, o SQL). Tablas `role_permissions`/`user_permission_overrides` en prod y VACÍAS. Nadie las lee todavía. El `.env` local NO tiene `DATABASE_URL`: hay que correrlo desde el servidor.
> - [ ] **Decisión 1 de la fase 1, YA TOMADA pero NO implementada:** `can()` debe leer `role` e `isActive` de la base, no del JWT. Hoy desactivar una cuenta no le quita permisos hasta que expire su token.
> - [ ] **Decisión 3 de la fase 1:** ¿estrechar `updateSystemConfig` a una lista blanca de claves? Hoy acepta cualquiera (round-robin, umbral de CAPI…).
> - [ ] Prerrequisitos menores antes de la fase 1: alinear `connectors/health/route.ts` (única ruta de conectores sin MARKETING) · cachear `rol→permisos` en `can()` (hoy 1 consulta por permiso) · anclar las 7 filas de `LEGACY_ROLE_LISTS` que siguen siendo transcripción a mano.
>
> **Nota:** hay **CERO usuarios con rol DIRECTOR**. 8 activos: 3 ADMIN, 2 MARKETING (uno es una pantalla), 1 GERENTE (Karla), 2 bot/QA. Detalle en la memoria `project_permisos_crm_estado`.
>
> ## 🔭 Pendientes activos (top)
> - [x] **BUG /admin crear usuario — RESUELTO** ✅ 2026-08-11 (commit `996e08f5`, push autorizado por Luis): `createUserSchema` → `.nullable().optional()` en phone/sedetusNumber/sedetusExpiry/teamLeaderId (el form manda `null` en vacíos y `.optional()` solo lo rechazaba en create, no en update) + dialog traduce Team Leader `"none"`→null (FK violation en create/update). Build verde + 1,486 tests PASS. Evidencia del bug: ZodError en `hbuilds/current/nodejs/console.log` (2026-08-11T14:43Z). Pendiente: smoke en prod (crear usuario con Teléfono/SEDETUS vacíos). Nota: rama remota `feat/admin-user-lifecycle` (otra sesión) podría retrabajar esta zona. Ver memoria `feedback_crm_admin_createuser_zod_null`.
> - [ ] **GW-1 Gmail** — enviar desde el CRM + auto-log entrantes/salientes + hilos, todo en `ActivityLog`. Pieza grande restante de Entregable B. (yo: código+migración por MCP; Luis: tópico Pub/Sub en GCP, o arrancamos con cron de respaldo)
> - [ ] **Luis: verificar SMTP** (forgot-password) y **cambiar la contraseña temporal** `<credencial retirada de este archivo>` de marketing@nativatulum.mx.
> - [ ] **Luis: SMTP_USER/SMTP_PASS** (Gmail/Workspace: smtp.gmail.com:465 + App Password de cuenta Workspace) en Hostinger.
> - [ ] Verificar `ActivityLog` en **detalle de deal** a runtime cuando exista un deal real (no verificado: pipeline en 0 deals).
> - [ ] (Futuro, aparte) GW-2 Calendar · GW-3 Google Contacts.
> - [ ] (Pre-existente) Aplicar SQL `unit_inventory.hold_deal_id` (Hub inventory hold) — sale en logs como ERROR.
>
> **🎯 Sesión 2026-08-11 (usuario Karla + diagnóstico bug /admin)** —
> - ✅ Usuario **Karla Muñoz** creado vía SQL directo en `propyte_crm.users` (jkarlamut@gmail.com, MARKETING, PDC, bcrypt 10; login Hub verificado por hash compare). Camino establecido: memoria `feedback-hub-user-creation`.
> - 🔍 **Root cause del fallo en crm.propyte.com/admin**: ZodError capturado en logs del servidor (mismo minuto del intento de Luis). El formulario de crear usuario NUNCA funciona con Teléfono/SEDETUS vacíos (ver pendiente arriba). Descartado: rol (Luis es ADMIN y el bundle desplegado del 08-08 incluye ADMIN en guards), deploy stale, conexión BD.
> - 📌 Hallazgo lateral: logs útiles del CRM están en `~/domains/crm.propyte.com/hbuilds/current/nodejs/console.log` (build activo), NO en `domains/crm.propyte.com/nodejs/` (stale, para el 08-03). Host SSH `propyte` (compartido).
>
> ### 🐛 AUDITORÍA EXTERNA 2026-06-15 (Claude Bug Finder) — 22 bugs · TRIAGE
> Corrida con sesión ADMIN heredada (marketing@nativatulum.mx) en crm.propyte.com. **Caveat clave:** la auditoría es del MISMO día que la **caída transitoria de BD Supabase** ("database system is not accepting connections", ya recuperada) → varios P0 (500 / Application Error / 503) **probablemente son ese outage, no bugs de código**. Reproducir ANTES de tocar código (ver [[feedback_data_gap_vs_code_bug]]).
>
> **A. Verificar si reproducen ahora (probable outage de BD, no código):**
> - [ ] BUG-04 `POST /api/contacts` 500 · BUG-08 `POST /reports` 500
> - [ ] BUG-05/06/07 Application Error en /commissions, /cobranza, /career (digests 262838427 ×2 + 2141296930) — mismo patrón de fallo server-side, coincide con la caída
> - [ ] BUG-14 HTTP 503 intermitentes en `*?_rsc=*` — coincide con recovery de BD + queries lentas del sync Zoho
>
> **B. Conocido / en progreso (no abrir nuevo):**
> - [ ] BUG-01 creds de auditoría no entran — `audit-temp@propyte.local` está **DESACTIVADO a propósito** (changelog 06-10) + sin hash. Expected. *Gap real derivado:* ✅ RESUELTO 2026-08-17 (PR #13) — botón de llave en /admin, solo ADMIN+DIRECTOR.
> - [ ] BUG-02/03 forgot-password / email-code 500 — ya migrado a Nodemailer/SMTP (commit `33d6f75`); **pendiente Luis: SMTP vars + verificar**. Mismo origen ambos.
> - [ ] BUG-19 workflows toggles inactivos — el cron `/api/cron/workflows` **no está agendado en Hostinger** (pendiente Luis ya listado). No es bug del toggle.
>
> **C. Probable FALSO POSITIVO (confirmar, casi seguro):**
> - [ ] BUG-09 "sesión cross-tenant de alterestate" — `marketing@nativatulum.mx` ES la cuenta ADMIN real de Luis en el CRM; el auditor confundió "ya había sesión activa" con "se aceptó sesión de otro dominio". NO hay relación con alterestate. Confirmar solo que `NEXTAUTH_SECRET` no se comparte.
> - BUG-20 admin expone emails — by design para ADMIN. No es bug.
> - BUG-16 KPIs en $0 · BUG-17 sin botón "Agregar Desarrollo" — esperado (pipeline en 0 deals; Desarrollos = Hub read-only por diseño). → mejorar copy/empty-state, no es bug.
>
> **D. Bugs reales a corregir (UX/funcional):**
> - [ ] BUG-10 form de Deal sin validación visible (no dice qué campo falta)
> - [ ] BUG-11 Walk-ins valida solo el primer campo required
> - [ ] BUG-12 routing SPA: URL directa carga página incorrecta (/developments→Cotizaciones, /hoy→Admin…) — investigar prefetch/layout vs efecto del 503
> - [ ] BUG-13 header/breadcrumb no actualiza el nombre de página activa (posible misma raíz que BUG-12)
> - [ ] BUG-18 copy roto en Cotizaciones: menciona botón "Cotizar" que no se ve sin deals
> - [ ] BUG-15 "Request Access" (landing) es `mailto:`, no formulario
>
> **E. Mejoras backlog:**
> - [ ] MEJORA-01 error boundaries (`error.tsx`) en commissions/cobranza/career — **alta prioridad real:** captura el crash de pantalla blanca aunque la causa sea la BD
> - [ ] MEJORA-02 toasts en CRUD · MEJORA-04 validación tel `libphonenumber-js` · MEJORA-05 dark mode en login
> - [ ] MEJORA-03 / BUG-16 onboarding checklist → ya en speckit consolidado §5.12 (onboarding guiado)
>
> **Confirmado OK por el auditor:** Vista Hoy, Pipeline Kanban, 8 workflows, Configuración, Walk-ins, Admin CRUD, Mi Config (tabs), Inbox (filtros), form de contacto completo, dark mode.
>
> #### ✅ VERIFICADO 2026-06-15 (logs postgres Supabase + lectura de código)
> - **Outage CONFIRMADO:** la BD `oaijxdpevakashxshhvm` crasheó+recuperó ≥2 veces hoy (mañana + ~23:27–23:32 UTC: "database system was interrupted… automatic recovery in progress… the database system is not accepting connections" ×N FATAL). **Grupo A (BUG-05/06/07/08 + parte de 04 + 14) = ese outage**, no código. NINGUNA página bajo `(dashboard)/` tiene `error.tsx` → toda excepción = pantalla blanca "Application Error" (por eso 05 y 06 comparten digest 262838427; career 2141296930 cae en otra query).
> - **BUG-04 SÍ es bug de código real (independiente de BD):** `POST /api/contacts` (route.ts ~276) NO valida que `assignedToId` exista en `users` antes del `create` → si el form manda un id inexistente → Prisma P2003 FK error → 500 genérico. Fix: validar/normalizar `assignedToId` o atrapar P2003 → 400 con mensaje. *(El resto del handler está bien: try/catch + zod con leadSource requerido.)*
> - **Riesgo latente real (no por BD):** null-deref con filas huérfanas — `deal.assignedTo.name`/`deal.contact.*` en `commissions.ts:180-184`, `act.user.name` en `reports.ts:366`, `deal.assignedTo.name` en `reports.ts:644`. Hoy no crashea (FKs íntegras) pero es frágil.
> - **MEJORA-01 sube a P0 real:** `error.tsx` por módulo convierte estos crashes de outage en "Reintentar" en vez de pantalla blanca. **Fix de mayor palanca** y de bajo riesgo.
> - **BUG-14 tiene causa de infra real:** la Supabase compartida es inestable (multi-crash hoy); sospechoso el **full-replace del sync Zoho cada 30 min** (20k+ filas/tabla, queries 15-19s). Evaluar sync incremental / recursos del proyecto.
> - **Ruido de logs NO del CRM:** `column unit_inventory.hold_deal_id does not exist` (SQL Hub hold pendiente, ya listado) y `duplicate key … Propyte_zoho_pending_deletes` + `ON CONFLICT … cannot affect row a second time` (bug del sync de borrados del **Hub**, no del CRM).
>
> **🎯 Sesión 2026-06-15 (Activación Gmail GW-0 + fixes de soporte)** —
> - ✅ **GW-0 Gmail OAuth ACTIVADO en prod**: migración `google_oauth_tokens` aplicada por MCP (FK→`users`, no `"User"`); cliente OAuth **Web** creado en GCP proyecto PROPYTE (antes solo Desktop google-ads-mcp); 4 env vars en Hostinger; **token de marketing@nativatulum.mx guardado → "Conectado"**.
> - ✅ **Fix redirect callback** (commit `596720a`): usaba `req.url` → `0.0.0.0:3000` tras proxy Hostinger; ahora usa `NEXTAUTH_URL`. Ver [[feedback_proxy_redirect_req_url]].
> - ✅ **Email transaccional Resend→Nodemailer/SMTP** (commit `33d6f75`). **SMTP = Gmail/Workspace** (smtp.gmail.com:465 + App Password), no Hostinger.
> - 🔍 **Causa raíz de login 401 + /api/activities 500 + /configuracion crash**: caída/recovery transitorio de la BD Supabase (logs "database system is not accepting connections"). Ya recuperada. Sesiones JWT seguían vivas → confundía el diagnóstico.
> - ⚠️ **Contraseña temporal** `<credencial retirada de este archivo>` (reset directo en BD; pgcrypto NO casa con bcryptjs.compare → hash con bcryptjs del repo). Ver [[feedback_pgcrypto_bcryptjs_mismatch]].
>
> **🎯 Sesión 2026-06-13 (Entregable A Actividades + Entregable B GW-0)** —
> - ✅ **Actividades en contacto y deal** (merge a main `1e366a4`): nuevo componente B/N `ActivityLog` (compositor + timeline interactivo: registrar/completar/editar/borrar, 17 tipos), API `PATCH/DELETE /api/activities/[id]`, server `deleteActivity`, predicado RBAC `canModifyActivity`+test. Montado en `contact-detail` y `deal-detail`. Sin migración (modelo ya existía). Smoke contacto PASS.
> - ✅ **GW-0 OAuth infra** (merge a main `c15a397`): `crypto-google`, modelo `GoogleOAuthToken`, `GoogleWorkspaceService`, rutas `/api/google/oauth/{connect,callback,status,disconnect}`, tab Google Workspace en `/settings`. Specs: `docs/superpowers/specs/2026-06-13-gmail-integration-design.md` + plan `docs/superpowers/plans/2026-06-13-gw0-oauth.md`.
> - Componentes coloridos viejos `activity-form`/`activity-timeline` quedaron intactos (orphaned; candidatos a borrar).
>
> **🎯 Sesión 2026-06-12 h (Fase 7 Agent Studio)** —
> Agent Studio (`src/components/config/agent-studio.tsx`): crear/editar agentes IA — goal/prompt,
> identidad usuario sistema (RBAC), autonomía L0-L2, tools permitidas (desde AGENT_TOOLS), trigger,
> límites, activar/pausar. Reusa upsert /api/admin/agents. Falta: simulación/preview, versionado.
> Requiere ANTHROPIC_API_KEY para ejecutar. **Tras esto: pausa para validaciones de Luis.**
>
> **🎯 Sesión 2026-06-12 g (Fase 5 experiencia)** —
> - **Command palette ⌘K** global (`src/components/layout/command-palette.tsx`, montado en layout):
>   búsqueda global contactos+deals (via /api/records/search) + navegación rápida.
> - **Vistas guardadas** (T5.4): modelo `SavedView` + **migración `saved_views` APLICADA** (con RLS).
>   API `/api/saved-views`, `SavedViewsBar` integrado en Contactos (guarda/aplica filtros).
> - Pendiente Fase 5: integrar SavedViewsBar en Pipeline/Cotizaciones; field/layout editor completo (T5.3 parcial ya existe).
>
> **🎯 Sesión 2026-06-12 f (Fase 4 automatización)** —
> - T4.1 **observabilidad** del motor en Config→Flujos: eventos pendientes/procesados(24h), cola,
>   fallidas, errores recientes + **retry manual** (`/api/admin/automation/retry`).
> - T4.2 **builder visual de reglas** (form-based, sin JSON): trigger + condiciones DSL por filas
>   (all/any · field/op/value) + acciones (16 tipos con config por tipo) + cooldown/prioridad +
>   guardar pausada/activar. API `/api/admin/automation/rules` (POST/PUT, Dirección/Admin).
>   Componente `src/components/config/workflow-builder.tsx`.
> - T4.3 cadencias NO incluido (Luis eligió solo reglas). Pusheado.
>
> **🎯 Sesión 2026-06-12 e (Fase 3 cotizador/cobranza) + deploy** —
> - T3.1 selector unidad Hub en cotizador (auto-precio + snapshot congelado).
> - T3.2 plan de pagos: ya existía (payment-plan-form / schedule-table).
> - T3.3 **landing pública** `/q/[id]` (sin auth, fuera del matcher): branding, unidad (snapshot),
>   precio, plan, vigencia, CTA WhatsApp; marca openedAt; bloquea si vencida.
> - T3.4 **Cobranza** `/cobranza`: aging de parcialidades (por vencer/1-30/31-60/61-90/90+) +
>   tabla de vencidas, RBAC. `src/server/cobranza.ts`. En sidebar.
> - Pusheado (deploy Hostinger auto). PENDIENTE: T3.3 PDF real (hoy es HTML imprimible),
>   registro de pagos en cobranza, smoke-test.
>
> **🎯 Sesión 2026-06-12 d (Fase 1 wiring + Fase 2 core) + PUSH a prod** —
> - **PUSH a main** (cuenta Propyte-Luis; estaba activa WebKoi → 403). Deploy Hostinger reconstruye
>   con el fix de hubUnitStatus + todo lo de la sesión. HUB_API_KEY ya puesta por Luis.
> - **Fase 1 Hub wiring (T1.2-T1.5)** CABLEADO: endpoints /api/hub/developments|units, deal form usa
>   IDs del Hub + snapshot, POST developments 403, hold al RESERVED / confirm al WON.
> - **Fase 2 core comercial:**
>   - T2.1 **Vista Hoy** (`/hoy`): SLA en riesgo, leads nuevos, conversaciones sin responder, tareas,
>     visitas, deals calientes, cotizaciones abiertas. RBAC. `src/server/today.ts`.
>   - T2.2 **Riel operativo del deal**: next-best-action por etapa + checklist por etapa + contexto de
>     unidad Hub (snapshot). `src/components/pipeline/deal-operational-rail.tsx`; getDeal incluye quotes/documents.
> - PENDIENTE: smoke-test autenticado de deal-detail y Vista Hoy (no verificable desde aquí).
>   Commits nuevos tras Vista Hoy quizá sin pushear según el momento.
>
> **🎯 Sesión 2026-06-12 c (Seguridad RLS + Fase 1 Hub T1.1)** —
> - **RLS habilitado en 45 tablas de propyte_crm** (advisory crítico de Supabase): cierra la
>   exposición vía anon key de contact_dossiers (KYC), quotes, conversations, etc. VERIFICADO
>   seguro antes: Prisma usa rol `postgres` (rolbypassrls=true) y el cliente JS usa service_role
>   → ambos saltan RLS; sin uso de anon key/Realtime contra propyte_crm. Sin políticas = deny-all
>   a anon/authenticated. Reversible (DISABLE). Aplicado vía MCP (Luis autorizó). 0 tablas sin RLS.
>   SQL: `prisma/migrations-manual/2026-06-12-enable-rls.sql`.
> - **Fase 1 Hub COMPLETA (CABLEADO)** — el CRM ya no posee inventario:
>   - T1.1 cliente Hub (`src/lib/hub/client.ts`+`types.ts`): lectura SQL directa a real_estate_hub
>     (decisión de Luis); holds via REST (x-hub-api-key). Env HUB_API_BASE_URL/HUB_API_KEY/HUB_WEBHOOK_SECRET.
>   - T1.2/T1.5: endpoints `/api/hub/developments` y `/api/hub/units` read-only; POST /api/developments
>     deshabilitado (403); página de desarrollos sin crear ("Catálogo del Hub · solo lectura").
>   - T1.3: deal form consume /api/hub/* y guarda hubDevelopmentId/hubUnitId; POST de deals valida
>     unidad contra el Hub + congela hubUnitSnapshot en Deal.custom.
>   - T1.4: RESERVED → requestUnitHold (conflicto bloquea, 409); guarda holdId/holdExpiresAt/reservedAt;
>     WON → confirmUnitHold.
>   - **FALTA de Luis:** poner HUB_API_KEY (=HUB_INTERNAL_API_KEY del Hub) para que el hold funcione;
>     smoke-test autenticado del flujo deal→reservar. La lectura de catálogo ya funciona (SQL directo).
>   - Cotizador con selector Hub = Fase 3 (T3.1), no incluido aquí.
>
> **🎯 Sesión 2026-06-12 b (Detalle de contacto + permisos de campo)** —
> Feedback de Luis sobre la vista de contacto (pestañas malas, sin notas, sin edición
> inline, sin estado de contacto, sin ocultación de campos). Entregado:
> - **Fase A (commit 1501410):** rediseño del detalle de contacto a UNA pantalla 2 columnas
>   (datos | seguimiento), sin pestañas. Header con estado/temperatura/tipo/urgencia editables
>   inline (ChipSelect → PUT). Barra resumen (último contacto, # actividades, próx. seguimiento,
>   deals, score). Edición inline por campo (InlineText/InlineSelectRow). Sistema de notas
>   (Activity NOTE) + timeline unificada. Diseño minimalista Speckit #6. `contactStatus`/`urgency`
>   agregados al PUT /api/contacts + constantes CONTACT_STATUS/URGENCY/CONTACT_TYPE.
> - **Fase B (commiteado):** permisos de campo CORE por rol. Modelo `CoreFieldPermission` +
>   **migración aditiva APLICADA** vía MCP Supabase (`core_field_permissions`, default sin fila = EDIT).
>   Catálogo `src/lib/metadata/core-fields.ts` (resiliente si falta tabla), API
>   `/api/admin/metadata/core-fields` (solo ADMIN), enforcement server-side (PUT bloquea no-EDIT,
>   page oculta HIDDEN), UI gating en el detalle, panel "Visibilidad de campos" en Configuración.
> - Build verde, 61 tests verdes. Pendiente: aplicar mismo gating a la LISTA de contactos y a Deal;
>   extender catálogo core a más módulos.
>
> **🎯 Sesión 2026-06-12 (Speckit MAESTRO — Fase 0 + bugs prod)** —
> Speckit/Plan maestro creados (`specs/SPECKIT-MAESTRO-PROPYTE-CRM.md`, `specs/IMPLEMENTATION-PLAN-MAESTRO-PROPYTE-CRM.md`).
> Auditoría de estado real: el proyecto está MUCHO más avanzado que el "Veredicto" del speckit (desactualizado).
> **Fase 0 cerrada:**
> - ✅ Build roto por `hubUnitStatus` (inexistente en Deal) → webhook `/api/webhooks/hub-unit` ahora
>   guarda el status en `Deal.custom` JSONB (cero DDL). Build verde, 61 tests verdes.
> - ✅ Roles inconsistentes: removido `ASESOR_SENIOR`/`ASESOR_JUNIOR` (inexistentes) en `sidebar.tsx`.
> **Bugs de producción del audit IA (cuenta admin/asesor en crm.propyte.com):**
> - ✅ **Dropdown "Contacto" vacío en Crear Deal** — BUG REAL: `/api/contacts` GET tenía el `if/else if`
>   de RBAC en orden incorrecto (OWN→TEAM→PLAZA→FULL). ADMIN ∈ TEAM_ACCESS_ROLES → caía en rama TEAM
>   y solo veía sus propios contactos. La lista server-side (`getContacts`/`buildRbacFilter`) chequea FULL
>   primero → por eso la lista SÍ mostraba todo pero el modal no. Reordenado: FULL/READ_ONLY → PLAZA → TEAM → OWN.
> - ✅ **Slug tarjeta "felipe-luksic"** — era el `placeholder` hardcodeado en `settings-view.tsx` (no un valor
>   real); el auditor lo leyó como default. Ahora el placeholder se deriva del nombre del usuario (kebab-case sin acentos).
> - ✅ Placeholder ficticio `4,130,844` en deal-form → neutro. Empty state del dropdown contactos con guía.
> **Confirmado por MCP Supabase (proyecto oaijxdpevakashxshhvm):**
> - Migración **F6 YA APLICADA** (tablas quotes/payment_plans/payment_schedules/deal_documents/external_brokers
>   existen). Las notas "⏳ pendiente aplicar" de sesiones previas estaban STALE.
> - 🔴 **CRÍTICO RLS:** 44 tablas de `propyte_crm` tienen Row Level Security DESHABILITADO (incl.
>   `contact_dossiers` KYC/PII, `quotes`, `conversations`, `deals`-relacionadas). Expuestas a quien tenga
>   el anon key (que usa el sitio web público). Requiere Fase 9 / decisión de Luis (no auto-aplicar: enable
>   sin policies bloquea todo el acceso). SQL de remediación disponible.
> **Hub API auditado:** Propyte_hub expone hold/release/confirm (`/api/inventory/units/[id]/*`, header
> `x-hub-api-key`) PERO **no** GET público de catálogo. El sitio web lee catálogo directo de Supabase
> (`real_estate_hub.Propyte_desarrollos`/`v_units`). Decisión Fase 1 pendiente: SQL directo vs MCP vs nuevo GET.
> **Pendiente roadmap (multi-sesión):** Fase 1 (Hub inventario), builder visual workflows/cadencias, Agent Studio,
> saved views, búsqueda global UI, command palette, MFA/ARCO/RLS, Google/LinkedIn CAPI, suite E2E, polish ES/EN + usuarios duplicados.

> Última actualización previa: 2026-06-11 noche-2 (Speckit #6 Diseño + WhatsApp Cloud API E2E).
>
> **🎯 Sesión 2026-06-11 noche-2** —
> **WhatsApp Cloud API FUNCIONANDO E2E** (sin Twilio): provider intercambiable
> (`lib/whatsapp/transport.ts`), webhook `/api/webhooks/whatsapp/meta`, template hello_world
> ENTREGADO al cel de Luis desde el stack del CRM (número test Propyte_App 1091031974089949;
> texto libre requiere ventana 24h — comportamiento esperado). App suscrita a WABA
> Propyte/Manychat SIN tocar ManyChat. Pendientes WhatsApp: webhook inbound (túnel o merge),
> número producción (re-verificar 984 323 5354 sacándolo de ManyChat).
> **Speckit #6 Diseño minimalista APLICADO** (`specs/SPECKIT-DISENO-WEB-MINIMALISTA.md`):
> Space Grotesk + JetBrains Mono tabular, tokens exactos (tinta #0A0A0A, hairlines, plano),
> espectro funnel por etapa como ELEMENTO FIRMA (dot columna + borde tarjeta + chip tinte/tono
> + stepper), FigureStat cifra-con-procedencia, .num en KPIs. Verificado visual con Playwright.
> ⚠ Build de producción NO corrido esta vez (dev de Luis activo comparte .next) — se valida al merge.
> **EN LA FILA:** speckit Google Workspace (correo/calendario/contactos — pedido de Luis) ·
> activación producción (merge→envs→crons→workflows→agentes).

>
> **🎯 Sesión 2026-06-11 noche (Speckit #4)** — P123 APLICADA + seeds ✅ (7 objetos, 4 relaciones).
> Speckit #4 versionado (`specs/SPECKIT-CONECTIVIDAD-AGENTES-CAPI.md`) + decisiones OQ1-7
> (`docs/superpowers/plans/2026-06-11-conectividad-agentes-capi.md`). Implementado:
> - **C1 Ingesta omnicanal**: providers de portales + Google/LinkedIn en ConnectorProvider,
>   direction INBOUND/OUTBOUND, click-ids ttclid/liFatId/portalLeadId en AdAttribution e intake,
>   webhook genérico de portales `/api/connectors/portal/webhook?cid=` (mapeo configurable).
> - **C2 Gateway CAPI**: ConversionEvent idempotente, PII SHA-256 normalizada (7 tests), adapters
>   Meta CAPI + TikTok Events REALES (Google/LinkedIn stubs), dispatcher con backoff en el cron,
>   eventos Lead/Qualified/MeetingScheduled/Reserved/Won(+value+quality tier) cableados al pipeline.
> - **C3 Agentes IA**: AgentDef (identidad = User con RBAC, PA1) + AgentRun auditable, registry de
>   8 tools tipadas (RBAC+opt-out+brand linter), runner Claude tool-use con escalado,
>   /api/admin/agents + /api/agents/[id]/run, seeds SDR + Calificador (L2, inactivos).
> - 61 tests verdes · build verde · pusheado.
> **✅ MIGRACIÓN C123 APLICADA** (Luis autorizó 2026-06-11) + seeds: user sistema
> `agentes@propyte.local` + agentes SDR Speed-to-lead y Calificador (L2, INACTIVOS hasta
> ANTHROPIC_API_KEY). `.env.example` reescrito con TODAS las vars requeridas + notas de dónde
> va cada una. CHECKLIST DE ACTIVACIÓN entregado en sesión (pasos 2-7 son de Luis).
> **Pendiente próxima sesión:** Agent Studio UI, adapter Google OAuth, LinkedIn, A2A, MCP server expuesto.

>
> **🎯 Sesión 2026-06-11 tarde (Speckit #3)** — F6 APLICADA en BD (Luis autorizó) ✅. Speckit
> Personalización & Equipos versionado (`specs/SPECKIT-PERSONALIZACION-Y-EQUIPOS.md`) + decisiones
> OQ1-7 en `docs/superpowers/plans/2026-06-11-personalizacion-equipos.md`. Implementado:
> - **P1 Equipos/Territorios**: Team/TeamMember(historial)/Territory(jerarquía+zonas)/TerritoryMember/
>   TerritoryRule. Ruteo integrado: PRIMERO territorio (DSL, hijo-antes-que-padre), LUEGO estrategia
>   dentro del territorio. APIs /api/admin/teams + /api/admin/territories.
> - **P2 Editor de campos**: registro metadata (objetos/campos/opciones/layouts/permisos por rol),
>   gobernanza anti-sprawl (convención apiName + detector de duplicados con force, solo ADMIN,
>   AuditLog), validador zod generado del registro + cache TTL 60s, contacts.custom/deals.custom
>   JSONB, /api/admin/metadata/fields + /api/records/[object]/[id]/custom, render dinámico
>   CustomFieldsSection montado en detalle de Contacto.
> - **P3 Relaciones**: RelationshipDef/Labels/Projections(max 5)/Rollups/RecordLink (puente genérico,
>   PC1) + /api/admin/relationships + /api/links + /api/records/search (picker; Hub = externo read-only).
> - 55 tests verdes · build verde · 4 commits pusheados.
> **✅ MIGRACIÓN P123 APLICADA** (Luis autorizó 2026-06-11) + seeds corridos y verificados:
> 7 objetos registrados (5 núcleo + 2 externos Hub), 4 relaciones sistema, 3 labels, 3 proyecciones.
> Sistema de personalización 100% operativo en BD.
> **Pendiente próxima sesión:** UI visual admin (tab Equipos + tab Campos + listas relacionadas en
> deal), rollups runner, P4 (objetos custom desde cero, fórmulas, búsqueda global).

>
> **🎯 Sesión 2026-06-11 (rebuild F2-F6, autónoma con aprobación de Luis)** — Continuación sin pausa:
> - **F1 ✅ APLICADA EN BD** (Luis autorizó): 17 tablas + seeds verificados (8 reglas, SLA, ruteo, plantillas).
> - **F2 ✅ Motor de workflows**: RuleEngine data-driven (DSL §D.4 con evaluador puro testeado),
>   ActionQueue pg-backed + runner con backoff, RoutingEngine, SlaEngine (FIRST_TOUCH 5min→RETRY→breach),
>   ActionPlanScheduler (cadencias), reglas INACTIVITY. Bot core: Claude voz Sage + brand linter +
>   HubCatalog (SQL read-only a real_estate_hub) + botRespond L2 con escalamiento. Wiring completo:
>   deal.stage_changed/won/lost, contact.created/lead.captured, WhatsApp in/out (conversación, opt-out
>   BAJA/STOP, SLA met). **Cron: `/api/cron/workflows` — Luis debe agendarlo en Hostinger CADA MINUTO
>   con header `x-cron-secret: $CRON_SECRET`** (mismo secret de env).
> - **F3 ✅ Conectores**: Meta Lead Ads webhook tiempo real (`/api/connectors/meta/webhook`, firma
>   SHA-256 + Graph API), TikTok pull (`/api/cron/connectors/tiktok` — **agendar cada 5 min**),
>   webhook web v2 (`/api/webhooks/leads`, X-Webhook-Secret), CRUD admin con credenciales cifradas
>   + UI en Admin→Integraciones. Anti-doble-alta: UNIQUE(connectorId, externalLeadId) + dedup E.164.
> - **F4 ✅ Inbox WhatsApp** (`/inbox`): 3 paneles estilo WhatsApp Web, takeover/release/notas internas/
>   toggle bot, resumen IA post-takeover, polling 5s. Smoke verificado con Playwright.
> - **F5 ✅ Perfiles** (`/settings`): perfil/correo(firma+alias)/tarjeta digital/plantillas con atajos.
>   Tarjeta pública `/t/{slug}` + vCard + QR SVG verificados E2E (slug inmutable).
> - **F6 ⏳ Cotizador**: schema completo (Quote/PaymentPlan/PaymentSchedule/DealDocument/ExternalBroker)
>   + cron de pagos vencidos (guarda defensiva). **SQL listo en
>   `prisma/migrations-manual/2026-06-11-f6-cotizador.sql` — decir "aplica la migración F6"**. UI cotizador
>   pendiente (siguiente sesión).
> - **F7 (inventario Hub)**: bloqueada por T5.1 en repo Propyte_hub (trabajo cross-repo).
>
> **ACCIONES DE LUIS para encender todo:**
> 1. "Aplica la migración F6" (o pegar el SQL en Supabase)
> 2. `KYC_ENCRYPTION_KEY` en .env local + Hostinger (generación en .env.example)
> 3. `ANTHROPIC_API_KEY` en Hostinger (el bot la necesita; sin ella, acciones IA se saltan con nota)
> 4. Crons Hostinger: `/api/cron/workflows` cada 1 min + `/api/cron/connectors/tiktok` cada 5 min
>    (header `x-cron-secret`)
> 5. Activar workflows: en BD `automation_rules.isActive=true` (los 8 están sembrados INACTIVOS a propósito)
> 6. Review + merge de las ramas `feat/audit-fixes-minimal-ui` → `feat/crm-rebuild-fase1` → main (en orden)
>
> **🎯 Sesión 2026-06-10 noche-2 (rebuild F1)** — Luis entregó el **Anexo Técnico** (diccionario de
> campos, funciones, motor de workflows, inventarios) + 3 requerimientos nuevos (conectores directos
> Meta/TikTok, inbox WhatsApp con takeover, perfiles de usuario) y aprobó el speckit resultante.
> Producido: `specs/SPECKIT-ANEXO-TECNICO.md` (verbatim) + `specs/SPECKIT-ANEXO-B-MULTICANAL-PERFILES.md`
> (nuevo, cierra OQs G.1-G.7) + plan maestro 7 fases + plan F1 detallado (`docs/superpowers/plans/`).
> **F1 EJECUTADA en rama `feat/crm-rebuild-fase1`** (5 commits, pusheada): 19 enums + 17 modelos nuevos
> (motor workflows/conectores/inbox/perfiles/KYC/atribución), extensiones a Contact/Deal/Message/User,
> `lib/phone` E.164 + `lib/crypto` AES-GCM + zod (30 tests verdes), seeds canónicos listos. tsc+build verdes.
> **⛔ BLOQUEADO — acción de Luis:** aplicar `prisma/migrations-manual/2026-06-10-f1-fundaciones.sql`
> (verificado 100% additivo: 19 CREATE TYPE, 17 CREATE TABLE, 0 DROPs) — decir "aplica la migración F1"
> en sesión, o pegarlo en el SQL Editor de Supabase. Después: `npx tsx scripts/seed-rebuild-f1.ts`.
> También requiere: `KYC_ENCRYPTION_KEY` en .env (generación documentada en .env.example).
> **Siguiente fase:** F2 motor de workflows (runner/cola/SLA/ruteo) — ver plan maestro.
>
> **🎯 Sesión 2026-06-10 noche (autónoma)** — ARRANQUE DEL REBUILD sobre el SPECKIT consolidado
> (`SPECKIT-PROPYTE-CRM-CONSOLIDADO.md` en Downloads; pendiente moverlo a `specs/`). Local reseteado a
> main `670f52d` (conflicto robot-02-images.yml: ganó el delete del remote). Audit Playwright completo
> del núcleo con usuario temporal ADMIN → 9 bugs/hallazgos, TODOS corregidos y re-verificados: ver
> `docs/audit-2026-06-10/AUDIT.md`. + **Rediseño minimalista B/N** (pedido de Luis: blanco/negro, color
> solo en etiquetas de etapa): tokens de `globals.css` reescritos, light default, dark neutro opcional.
> **Rama `feat/audit-fixes-minimal-ui` (commit `d1b15dc`, pusheada) — PENDIENTE: review de Luis + merge a main.**
> Build verde + tsc limpio. Datos de prueba borrados de BD; usuario `audit-temp@propyte.local` DESACTIVADO.
> **Veredicto fork `import-crm-base-fork` (NextCRM):** NO usar como base — superseded por el speckit
> consolidado (base = propyte-crm limpio). Queda como referencia; no mergear.
> **Próximos pasos:** (1) Luis revisa rama y mergea; (2) mover speckit a `specs/`; (3) Fase A del roadmap
> (API catálogo read-only en el Hub, T5.1 — repo Propyte_hub); (4) `/developments` del CRM a read-only
> contra el Hub (quitar "Nuevo Desarrollo", P1 del speckit).
>
> **🎯 Sesión 2026-06-10** — F1 COMPLETA (robots verdes en Hub, workflows fuera del CRM). T2.3 ✅ (captura fuera, `d85a0d4c`). Matriz paridad Zoho ✅ (`specs/zoho-parity-matrix.md`, veredicto: no apagar cron CRM hasta resolver inbound). Decisión Luis: **Opción B** + conservar UI visual de discrepancias. F3 código ✅ (rama `feat/meta-leads` Hub, `95c4c94`, build verde). **Bloqueado en: aplicar meta-leads.sql (sin acceso BD)**. Hallazgo: CAPI probablemente muerto (contacts=0). OQ2 abierta (dashboards Meta Ads).
>
> **🎯 Sesión 2026-06-09** — Auditoría completa CRM vs Hub + spec aprobado: `specs/crm-hub-migration-cleanup.md`. Decisiones de Luis: (1) Hub = dueño único del catálogo+Zoho catálogo, CRM solo lectura vía API; (2) todo Meta → Hub; (3) migración por fases apagar-antes-de-borrar. Meta final: propyte-crm 100% limpio (solo núcleo CRM) para rebuild.
>
> **✅ Sesión 2026-06-08** — branch `fix/classifier-dedup-key`, HEAD `51e98c2`. Nuevo endpoint `src/app/api/zoho/push-record/route.ts` (push on-demand de un registro a Zoho). Se trackeó por fin `task_manager.md` (era archivo local sin commitear).
>
> **✅ Sesión 2026-06-06** — Fix bug #4 del robot 01-classifier (`1a671a5`): la clave de upsert `(lower(nombre_desarrollo), id_desarrollador)` era inestable (lower() sensible a acentos `Cancún≠Cancun`; id_desarrollador variaba entre corridas) → duplicaba desarrollos. Ahora persiste `ext_dedup_key` (nombre normalizado: lower + sin acentos + sin puntuación) y deduplica con `ON CONFLICT(ext_dedup_key)`. Requiere DDL prod `robot_infra_0004` (columna + backfill + índice único parcial). Prod ya limpio (48 grupos / 49 dups). **Pendiente: merge a main + drop índice viejo.** Ver [[feedback_mpgenesis_robot_duplicate_devs]].
>
> **✅ Sesión 2026-06-03** — Formulario externo de captura de desarrollos (`e2d7587`, merge). Link público con token (sin login) → cola de revisión en `/developments` tab "Captura" → al aprobar crea/actualiza catálogo `real_estate_hub` en borrador (nunca publica), con tipologías + imágenes (bucket de cuarentena). Tablas `intake_links`/`intake_submissions` aplicadas a prod (`add_intake_tables`). + `2a0ff56` preserva estado de publicación al actualizar dev + valida status query; + `1f2cd80` script de limpieza de cuarentena (>30d no aprobadas). **⚠️ Nota:** este intake se construyó por error en `propyte-crm` (crm.propyte.com); decisión de Luis fue "dejarlo por ahora" — falta reimplementar en el Hub (hub.propyte.com). Ver [[reference_hub_domain_captura]].

## En progreso

### Spec: Migración y limpieza CRM→Hub — `specs/crm-hub-migration-cleanup.md`

> Orden: Fase 0 → 1 → 2 → 3 → 4 → 5 → 6. Principio: confirmar/crear destino en Hub → apagar en CRM → borrar código. NUNCA borrar antes de verificar el reemplazo.

- [x] **T0.1** ✅ 2026-06-09 — OQ1: cron Zoho CRM **VIVO cada 15 min** (corre :00/:15/:30/:45, Hostinger). Drip-feed terminado (3/1178 pending; 274 units con pipeline_status NULL fuera de alcance del sync). Conteos: `meta_leads`=756 (activo hoy → **migrar a Hub**, OQ3 resuelto), `meta_*` cache regenerable, `monitored_folders`/`sync_jobs`=**0** (Drive-sync muerto de facto → OQ5 resuelto: F4 = solo borrar), `intake_*`=2+2 prueba, `developments`/`units`/`contacts`/`deals` Prisma=**0 filas** (cascarón, nada que migrar; T5.2 se simplifica)
- [x] **T0.2** ✅ Secrets: `SUPABASE_DB_PASSWORD` (los 5), `BANXICO_API_TOKEN` (robot 01), `ANTHROPIC_API_KEY` (robot 05). Sin `gh` CLI → **handoff Luis** crear los 3 en Settings→Secrets del repo Propyte_hub
- [x] **T1.1** ✅ 2026-06-09 — Rama `feat/robots-from-crm` pusheada en Propyte_hub (commit `78da2f9`, 39 archivos): `src/robots/*` intacto (desde fix/classifier-dedup-key), schema.prisma mínimo robots-only, 5 workflows (prisma generate → schema robots), scripts ops + `scripts/robot-sql/`, devDeps CI-only, tsconfig exclude. Worktree local: `../Propyte_hub-robots`
- [ ] **T1.2** 1 dispatch verde por robot desde repo Hub — EN CURSO 2026-06-09 noche: Luis creó secrets + mergeó (PR #13, main `32d0a74`). **Run #1 rental-estimates FALLÓ** (exit 1 @52s). Diagnóstico FINAL: build OK (npm ci + prisma generate verdes en repro local); secrets SÍ existen como Repository secrets (confirmado Luis) → la causa es el **VALOR** de `SUPABASE_DB_PASSWORD`: debe ser la contraseña Postgres del proyecto `oaijxdpevakashxshhvm` (hardcodeado en `src/robots/shared/db.ts:17` y `refresh-rental-estimates.ts:21` — la MISMA Supabase compartida; NO la de Intel Hub `fsoqfpblzhhqsrybsipp`, NO un JWT service_role/anon). Copiar de `propyte-crm/.env` → `SUPABASE_DB_PASSWORD`. Pendiente: Luis corrige valor + Re-run de los 5.
  - ✅ RESUELTO 2026-06-10: Luis confirmó escenario **B** — solo copió la contraseña vigente al secret del Hub, NO hubo reset en Supabase. Nada roto en producción. Hallazgo lateral: **el `.env` local de propyte-crm tiene un `SUPABASE_DB_PASSWORD` viejo/inválido desde antes** (los robots del CRM usaban el GH secret, no el .env) → actualizarlo cuando se pueda para recuperar la vía de verificación local por BD. Mientras: MCP Supabase desconectado + .env stale = sin acceso a BD desde esta máquina; verificación de corridas = GitHub Actions UI (Luis) o esperar reconexión del MCP. Verificación de corridas Hub vía `Propyte_robot_runs.git_sha='32d0a74'` (la tabla distingue repo por sha)
  - ⚠️ Descubierto: el PAT del vault es fine-grained **solo con acceso a propyte-crm** (404 contra Propyte_hub) → dispatch por API imposible hasta ampliar el token
  - 🐛 Descubierto: entrada del vault INVERTIDA (name=token en texto plano, secret='github_pat') → `fn_dispatch_robot_if_needed()` roto desde abril (explica response_status=-1 en robot_trigger_log). Pendiente decisión Luis: reparar entrada + borrar fila malformada + rotar PAT
  - ℹ️ Redundancia detectada: pg_cron job 2 ya hace `REFRESH ... rental_estimates` diario directo en SQL → el workflow rental podría simplemente eliminarse en vez de migrarse (decidir con Luis)
- [x] **T1.2** ✅ 2026-06-10 — **Robots 01/02/04/05 VERDES en el Hub** (confirmado Luis en Actions; sha `32d0a74`). Único rojo: rental-estimates (run #3, exit 1 @46s) — password descartado como causa (robots usan misma BD y pasan); pendiente log del step rojo para diagnóstico. Candidato a ELIMINARSE por redundancia: pg_cron job 2 hace el mismo REFRESH diario 05:00 UTC dentro de Postgres (mismo horario que el workflow → posible colisión REFRESH CONCURRENTLY); verificar `cron.job_run_details` cuando haya acceso a BD
- [x] **T1.3** ✅ 2026-06-10 — Commit `0208723d` pusheado directo a main del CRM (autorizó Luis): los 4 workflows de robots ELIMINADOS del CRM. **FASE 1 COMPLETA: robots viven solo en el Hub, sin ejecución duplicada.** `refresh-rental-estimates.yml` se conservó en CRM como respaldo (su gemelo del Hub falla, en diagnóstico — ver pendiente abajo); `src/robots/*` se conserva hasta T6. Worktree `propyte-crm-cleanup` eliminado; `Propyte_hub-robots` se conserva para depurar rental. Bonus: PR #7 (`fix/classifier-dedup-key`) ya estaba mergeado por Luis — queda solo "drop índice viejo"
- [ ] **T1.4 (residuo)** Rental-estimates en Hub falla (exit 1 @46s, runs #1/#3; password descartado). Resolver por una de dos vías: (a) log del step rojo → fix; (b) verificar `cron.job_run_details` del pg_cron job 2 (mismo REFRESH diario 05:00 UTC en Postgres) → si sano, ELIMINAR el workflow en ambos repos por redundante
- [ ] **T2.1** Confirmar paridad Zoho catálogo Hub vs CRM; apagar cron/endpoint del CRM — **bloqueado por: drip-feed units debe terminar primero**
- [ ] **T2.2** Borrar Zoho catálogo del CRM (`lib/zoho/*`, `api/zoho/*`, dashboards, sidebar) — depende de T2.1
- [x] **T2.3** ✅ 2026-06-10 — Captura ELIMINADA del CRM y pusheada a main (`d85a0d4c`, −1,181 líneas): 21 archivos + 4 refs (tab layout, middleware, npm script, modelos Prisma; tablas BD conservadas con histórico). Build verificado verde (tsc + next build) antes del push. ⚠️ Los 2 intake_links del 06-04 mueren con el deploy — el intake vivo es hub.propyte.com/captura
- [x] **T2.1-prep** ✅ Matriz de paridad Zoho lista: **`specs/zoho-parity-matrix.md`**. VEREDICTO: **NO apagar el cron del CRM todavía**. Outbound cubierto por Hub (✅, incluso superior); **GAP CRÍTICO inbound**: el CRM llena `Propyte_zoho_{leads,contacts,deals,accounts}` (que lee la reconciliación Meta Leads) y el Hub escribe a OTRAS tablas (`reports.zoho_*`). Gaps menores: whitelist saliente sin precio min/max ni ROI; `Propyte_zoho_id_map` sin equivalente. **Decisión pendiente (Luis): Opción B recomendada** = al portar Meta Leads al Hub (T3.1), que lea `reports.zoho_contactos` y se retiren las tablas `Propyte_zoho_*`; fallback A = portar la Fase 2 inbound al Hub. → T2.1/T2.2 se REORDENAN después de Fase 3
> **DECISIÓN LUIS 2026-06-10: OPCIÓN B** — el matching de Meta Leads en Hub lee `reports.zoho_contactos` (pipeline inbound del Hub); las `Propyte_zoho_*` se retiran junto con el cron del CRM al cerrar F3. **Requisito explícito de Luis: conservar el sistema VISUAL de discrepancias** (overview/discrepancias/whatsapp/export CSV) para revisión manual.

- [x] **T3.1+T3.2 (código)** ✅ 2026-06-10 — Construido, build verde (exit 0) y **pusheado: rama `feat/meta-leads` del Hub, commit `95c4c94`** (10 archivos, +872). NO mergeada a main — activación pendiente (ver orden abajo). Piezas:
  - `scripts/sql/meta-leads.sql` — DDL `real_estate_hub.meta_leads` (RLS ON sin policies) + migración one-shot de las 756 filas de `propyte_crm.meta_leads` (misma Supabase, INSERT..SELECT camelCase→snake_case, idempotente). **Aplicar ANTES de mergear a main**
  - `src/lib/meta-leads/sync.ts` — sync Meta Lead Ads API (TODAS las cuentas de `META_AD_ACCOUNT_IDS`, no solo la 1ª como el CRM) + matching vs `reports.zoho_contactos` (email + `telefono`, normalización 10 dígitos). MISSING_IN_CRM se re-evalúa cada corrida (puede pasar a MATCHED si el contacto aparece en Zoho); MATCHED/DUPLICATE terminales. Paginación range() (cap PostgREST 1k) + chunks .in() 100
  - `src/app/api/cron/sync-meta-leads/route.ts` — patrón cron del Hub (assertCronAuth + runIngest→sync_log). **Agendar en Hostinger 15-30 min** al activar
  - UI `(dashboard)/meta-leads/{page,discrepancies,whatsapp}` + tabs + KPIs + StatusBadge + ExportCsvButton (BOM CSV) + entrada Sidebar grupo Reportes
  - Activación (orden): 1) aplicar SQL 2) merge main + deploy + PM2 restart 3) agendar cron 4) verificar 5) recién entonces T3.4 borrar Meta del CRM
  - Nota typecheck: 2 errores PREEXISTENTES de main en `tests/hub-to-zoho-mapper.test.ts` (no míos)
- [x] **T3.1-activación (BD)** ✅ 2026-06-10 — `.env` creado + Luis pegó el password → **`meta-leads.sql` APLICADO** vía `scripts/apply-sql-file.ts`: tabla `real_estate_hub.meta_leads` + 5 índices + RLS + **760 leads migrados** (4 más que el conteo de la mañana — el cron del CRM seguía sumando). Verificado: los 760 están MATCHED (cero discrepancias activas al momento de migrar). Robots re-verificados en BD: corridas success con sha `32d0a743` (Hub). Rama `feat/meta-leads` actualizada (`af77063`: + runners `apply-sql-file.ts`/`query-sql.ts` + fix rental documentado).
- [x] **T1.4 rental** ✅ CERRADA 2026-06-10 — Causa raíz: el único índice UNIQUE de `investment_analytics.rental_estimates` era de expresiones COALESCE; REFRESH CONCURRENTLY exige columnas planas → fallaba DIARIO (pg_cron job 2 + workflows; nunca fue el password). **Fix aplicado con OK de Luis** (`fix-rental-estimates-unique-index.sql`: índice plano + smoke test REFRESH OK en 607ms). Workflows rental ELIMINADOS de ambos repos (Hub: commit `70b6034` en rama; CRM: `5f8398f0` pusheado a main) — pg_cron queda como mecanismo único, vuelve a correr solo desde mañana 05:00.
- [x] **T3.1-activación (deploy)** ✅ 2026-06-10 — Luis autorizó explícitamente → **push a main del Hub hecho: `8c78912..b3b2a2e`** (Meta Leads completo + runners ops + retiro workflow rental). **Quedan los 2 pasos Hostinger de Luis: (1) restart PM2 del Hub, (2) agendar cron `https://hub.propyte.com/api/cron/sync-meta-leads` cada 15-30 min (CRON_SECRET).** Tras eso: verificar /meta-leads en hub.propyte.com y arrancar T3.4.
- [x] **DEPLOY HUB** ✅ FIX PUSHEADO 2026-06-10 (`b3b2a2e..1e70f44` a main) — Causa (del log de Luis): `scripts/query-sql.ts:26` implicit any; los runners SQL se crearon DESPUÉS del typecheck/build local y nunca se validaron (lección: validar con `npm run build` completo antes de pushear). Fix: tipos `unknown` explícitos + ambos scripts CLI al exclude del tsconfig. Verificado con pipeline idéntico a Hostinger (npm run build verde). **Auto-deploy debe correr solo con el push; Luis verifica "Last deployment" verde en hpanel → restart PM2 → el cron (ya agendado) empieza a pegar al endpoint real**
- [x] **Deploy VERDE confirmado por Luis** (2026-06-10) — /meta-leads visible en prod con los 760 leads ✅. **+ Botón "Forzar sync" agregado a pedido de Luis** (`1e70f44..7eb0348` a main): POST `/api/meta-leads/sync` (sesión + permiso "sync", trigger=manual) + SyncNowButton en header de tabs con resumen en vivo. Validado con npm run build completo antes del push. PENDIENTE VERIFICAR: primera corrida del cron en `reports.sync_log` (modulo lead_forms) — aún sin filas; si tras 2 ventanas de 20 min sigue vacío, revisar el comando del cron de Luis (¿secret correcto? un 401 de assertCronAuth NO deja registro) Tras SQL: merge `feat/meta-leads`→main + PM2 restart (Luis) + agendar cron Hostinger (Luis) + verificar KPIs + revisar `cron.job_run_details` (cierra también T1.4 rental)
- [ ] **T3.3** Consolidar Meta Ads en Hub (OQ2 ABIERTA: ¿reuse `/reportes/kpis` o portar dashboards dedicados — campañas con semáforos, galería de ads, audiencias?). **Hallazgo 2026-06-10: CAPI probablemente MUERTO** — el webhook Zapier→CRM que lo dispara crea filas en `propyte_crm.contacts` que tiene 0 filas → el zap está apagado o falla en silencio. Confirmar con Luis si hay zaps activos hacia crm.propyte.com; si no, CAPI se DESCARTA (no se porta) y T3.3 = solo dashboards
- [x] **T3.1+T3.2 VERIFICADO E2E** ✅ 2026-06-10 21:00 UTC — cron corrió (45 leídos, 1 lead nuevo insertado+matcheado) + botón Forzar sync de Luis OK (21:08, manual, ok). Meta Leads 100% operativo en Hub. **Esto desbloquea T2.1/T2.2**: el único consumidor de `Propyte_zoho_leads` (matching viejo del CRM) quedó muerto de facto
- [x] **T3.4a** ✅ 2026-06-10 — Meta LEADS fuera del CRM, **pusheado a main (`96e87537`, −2,042 líneas)**: 7 páginas + 3 rutas API + server + modelo Prisma (tabla BD conservada) + sidebar. Build verde pre-push. **Luis: revisar si hay cron en Hostinger apuntando a `crm.propyte.com/api/meta-leads/sync` y borrarlo.** Worktree t34 con dir bloqueado por Windows (git pruned; borrar carpeta luego)
- [ ] **CRONS DEL CRM EN HOSTINGER (guía dada a Luis 2026-06-10)** — borrar los que apunten a crm.propyte.com EXCEPTO uno: ❌ `/api/zoho/sync/cron` (15min; reemplazado por Hub), ❌ `/api/meta-leads/sync` (endpoint ya 404), ❌ `/api/sync/cron` Drive/Dropbox (muerto); ✅ **MANTENER `/api/meta-ads/sync`** — alimenta los dashboards Meta Ads aún vivos en el CRM; se borra hasta T3.4b (OQ2). NO tocar crons de hub.propyte.com. Pendiente: confirmación de Luis → dispara T2.2+T4
- [x] **T2.2+T3.4b+T4 (DEMOLICIÓN GRANDE)** ✅ EN MAIN — commit `52268f3e` (76 archivos, **−15,225 líneas**: Zoho completo + Meta Ads completo + Drive-sync completo + 4 ediciones quirúrgicas). **Nota: lo commiteó/pusheó una SESIÓN PARALELA de Luis** (15:32 local) que tomó el worktree t22 con mi trabajo staged; verifiqué inactividad (3h de mtimes) antes de retomar — patrón [[feedback_detect_active_sessions_mtime]]
- [x] **T4** ✅ — incluido en `52268f3e` (OQ5 había confirmado pipeline muerto: 0 carpetas)
- [x] **T6 (LIMPIEZA FINAL)** ✅ 2026-06-10 — commit **`95070218`** en main (61 archivos, −5,948): `src/robots/` fuera (corren en Hub), 10 scripts ops robot/zoho/meta + `scripts/sql/robot_infra_*` + `create_*_sync_log.sql` fuera (viven en repo Hub), `sync-local/` fuera, package.json sin scripts robot:* ni deps huérfanas (@anthropic-ai/sdk, googleapis, pdf-parse, xlsx, @types/pdf-parse), `.env.example` núcleo, lockfile regenerado. Build verde pre-push.

## 🏆 MIGRACIÓN CRM→HUB: CÓDIGO COMPLETO (2026-06-10)

**crm.propyte.com = núcleo CRM puro**: Dashboard, Contactos, Pipeline, Desarrollos(ref), Comisiones, Reportes, Walk-ins, Career, Actividades, Twilio, Auth, Admin, webhooks Zapier (sin CAPI). En 7 commits del día se retiraron: robots (→Hub, verdes), captura (→Hub), Meta Leads (→Hub, verificado E2E), Zoho catálogo (→Hub autoritativo), Meta Ads (→Hub futuro), Drive-sync (muerto), rental workflow (→pg_cron). **~23,200 líneas eliminadas.** Listo para el rebuild.

### Post-migración (backlog corto)
- [ ] **Luis confirma**: crons del CRM borrados en Hostinger (dijo "procedo a borrar todos" — falta confirmación)
- [ ] **Fix índice rental** (T1.4): `Propyte_hub:scripts/sql/fix-rental-estimates-unique-index.sql` listo; clasificador exige autorización textual de Luis ("aplica el fix del índice de rental"). Sin él, `rental_estimates` sigue sin refrescarse a diario
- [ ] **T5 (API catálogo Hub→CRM)**: DIFERIDA al proyecto de rebuild (contacts/deals=0; el consumidor aún no existe)
- [ ] Meta Ads → Hub (proyecto futuro, decisión Luis)
- [ ] Seguridad (handoffs Luis): rotar `CRON_SECRET` (expuesto 05-29), rotar PAT `github_pat_11B75…` (en texto plano en vault.secrets.name) + reparar entrada invertida del vault, rotar `ghp_Rsz…` (pendiente desde 06-08)
- [ ] Verificar 1ª corrida programada de robots Hub (mañana ~06:00 UTC) + pg_cron rental tras el fix
- [ ] **T5.1** API catálogo read-only en Hub (`/api/catalog/developments`, `/:id`, `/units`) con auth
- [ ] **T5.2** CRM consume API catálogo; `Deal` liga IDs del Hub; borrar modelos `Development`/`Unit` Prisma — depende de T5.1
- [ ] **T6.1** Depurar sidebar, `prisma/schema.prisma` (solo core), `.env.example`, deps huérfanas
- [ ] **T6.2** `next build` verde + deploy + documentar estado final
- [ ] **T6.3** (handoff Luis) Rotar `CRON_SECRET` (OQ6)

### Trabajo previo Zoho sync (parcialmente superseded por la migración — el sync del CRM se decomisiona en T2.x)

- [ ] **Merge `fix/classifier-dedup-key` → main** + aplicar DDL `robot_infra_0004` en prod + drop índice único viejo (el de `lower(nombre)`). Re-run del robot 01-classifier para confirmar 0 dups nuevos.
- [ ] **Push-record API (`/api/zoho/push-record`)** — quedó como WIP; validar end-to-end (auth + payload + respuesta Zoho) antes de cablearlo a un botón/cron.
- [ ] **Drip-feed units a Zoho** — 228 units Borrador pending (de 1334 totales). Esperado: ~5 crons (75 min) al ritmo actual de ~50 creates/cron. Wakeup programado para verificación.
- [ ] **Backpoblación address+amenidades en 638 devs ya en Zoho** — requiere UPDATE `zoho_last_synced_at=NULL`. Esperar a que drip-feed units cierre primero (no saturar). Bloquea: autorización Luis "OK forzar resync devs".

## Pendientes (acciones Luis)

- [ ] **Restart PM2 Hub Hostinger** — Hostinger Git pull NO reinicia PM2. Sin restart, fix webhook `e94ef6e` no se activa y Nativa Tulum se re-corrompe cada cron. También bloquea image-health monitor nuevo.
- [ ] **Decidir migration `user_table_preferences`** — Archivo `Propyte_hub/supabase/user_table_preferences_migration.sql` sin track. Si se usa la feature table-personalization, ejecutarlo; si es WIP, dejar.

## Pendientes técnicos (sesión futura)

- [ ] **Diagnóstico CORASOL "invalid data"** — 2 records (`4e20ec1d-…` original + `f9628af4-…` copia). ZTEST manual con payload básico pasó pero el real falla. Hipótesis: algún field específico (URL con chars especiales? trailing space en `meta_title_unidad`?). Plan: ZTEST update incremental.
- [ ] **2 units "duplicate data"** — Cron 23:01 del 2026-05-22 + cron 15:45 del 2026-05-23. Hipótesis: `Product_Name` colisionado entre 2 unidades. Query: `SELECT slug_unidad, titulo_unidad, COUNT(*) FROM Propyte_unidades GROUP BY 1,2 HAVING COUNT(*)>1`.
- [ ] **id_desarrollador → Desarrollador lookup** — UUID Supabase → Zoho Account ID via `Propyte_zoho_id_map`. Requiere lookup async, no encaja en `mapRecord` síncrono. Ver memoria `feedback_zoho_desarrollador_lookup_pendiente.md`.
- [ ] **Fase 7: Webhook Zoho → Supabase realtime** — `propyte-crm/src/app/api/zoho/webhook/[module]/route.ts` con HMAC + idempotencia (decisión Luis: SOT=Zoho para Borrador/Revision necesita webhook fast-path).
- [ ] **Fase 8: Hub UI badge `pipeline_status` + edit condicional** — `Propyte_hub/src/components/common/FieldEditor.tsx` debe mostrar badge + bloquear edits cuando SOT=Zoho.
- [ ] **Fase 9: Auditoría mappers Next_Propyte_web** — UnitDetail, DevDetail, listings, SchemaMarkup. Que cada field editorial respete fallback editable > legacy.
- [ ] **Fase 10: Cleanup scraper Listings Generator** — depositar `pipeline_status='Borrador'` en lugar de inserción directa.

## Bloqueadas

- [ ] **Backpoblación address en LUA 3030 + 637 devs** — bloqueada por autorización Luis ("OK forzar resync devs"). Sin esto, el fix `8a9c92d` (Direcci_n_*) no se aplica a los devs ya sincronizados.

## Completadas recientes

- [x] (2026-05-23) ALTER TABLE Propyte_desarrollos +4 cols (brochure_pdf_en, carpeta_imagenes_url, carpeta_imagenes_2_url, plano_url)
- [x] (2026-05-23) Auditoría completa mapping → 4 fixes aplicados (commit `1869163`)
- [x] (2026-05-23) 4 fields URL nuevos en Zoho + mappings + Hub fields-config (commits `0c04f35` + `5f43c5e`)
- [x] (2026-05-23) Fix orphan units (458 sin id_desarrollo, commit `0ff02c8`)
- [x] (2026-05-23) Fix webhook Hub `Direcci_n_*` struct (commit `e94ef6e` en Propyte_hub)
- [x] (2026-05-23) Fix address Direcci_n_* struct + Amenidades multiselect (commit `8a9c92d`)
- [x] (2026-05-23) Fix syncUnitsToZoho silente (`.in()` overflow, commit `39ab723`)
- [x] (2026-05-23) Picklists Zoho actualizados (7 fields, +33 valores canónicos Hub)
- [x] (2026-05-23) Cleanup Supabase tipo_unidad (91 rows) + estado_unidad (1330 rows) + chk constraint
- [x] (2026-05-22) Fase 6 v2 push (commit `c364ac7`): scope todos los estados + cleanup picklist

## Notas

**Cómo correr la auditoría de mapping:**
```bash
node scripts/audit-zoho-supabase-mapping.cjs
```
Lee field-maps.ts + cache de Zoho getFields + lista hardcoded de cols Supabase. Reporta 3 categorías: mapeos rotos, gaps Supabase→Zoho, fields Zoho sin uso.

**Cómo verificar drip-feed:**
```sql
SELECT 'units' AS tabla, pipeline_status::text AS estado,
       COUNT(*) AS total, COUNT(zoho_record_id) AS en_zoho,
       COUNT(*) - COUNT(zoho_record_id) AS pending
FROM real_estate_hub."Propyte_unidades"
GROUP BY pipeline_status ORDER BY pending DESC;
```

**Memoria de la sesión:**
- `~/.claude/projects/c--Users-ptoral-Projects/memory/project_propyte_crm_zoho_sync_estado_2026_05_22.md` — snapshot actual del sync (sobre-escrito en cada sesión)
- `~/.claude/projects/c--Users-ptoral-Projects/memory/feedback_postgrest_in_filter_overflow.md`
- `~/.claude/projects/c--Users-ptoral-Projects/memory/feedback_zoho_address_direccion_struct.md`
- `~/.claude/projects/c--Users-ptoral-Projects/memory/feedback_zoho_update_field_picklist_syntax.md`
- `~/.claude/projects/c--Users-ptoral-Projects/memory/feedback_zoho_sync_backpoblacion_manual.md`
- `~/.claude/projects/c--Users-ptoral-Projects/memory/feedback_zoho_desarrollador_lookup_pendiente.md`

### Limpieza de ramas (2026-06-10 noche)
- [x] **9 ramas eliminadas** (5 remotas + 4 locales): Funciones_avanzadas, chore/disable-robot-02-images-schedule, fix/classifier-dedup-key (su único commit no-mergeado era el WIP push-record de Zoho — código ya demolido), fix/classifier-estado-unidad-capitalizado, fix/classifier-slug-fallback-titulo, feat/intake-form-captura-externa
- [x] **`import-crm-base-fork` CONSERVADA (decisión Luis 2026-06-10)** — 1,436 commits del import del proyecto externo "crm-base"; queda como material de referencia para el rebuild
