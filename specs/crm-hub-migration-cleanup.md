# Spec: Migración y limpieza propyte-crm → Propyte_hub (CRM core para rebuild)

> Estado: **draft** | Fecha: 2026-06-09 | Proyecto: propyte-crm + Propyte_hub

## 1. Overview

`propyte-crm` (crm.propyte.com, Next 14 + Prisma sobre schema `propyte_crm`) acumuló funcionalidad que **no es CRM**: sync de catálogo con Zoho, captura pública de desarrollos, robots de contenido de mpgenesis, dashboards de Meta Ads, reconciliación Meta↔Zoho de leads, y un pipeline de ingesta Drive/Dropbox. Buena parte de eso **ya existe — y más completo — en `Propyte_hub`** (hub.propyte.com, Next 15 + Supabase `real_estate_hub` + service_role).

El objetivo es **decomisionar del CRM todo lo que no es CRM-core** (apagando duplicados que el Hub ya cubre y portando al Hub lo que falte), para dejar `propyte-crm` reducido a su núcleo real (contactos, pipeline/deals, comisiones, walk-ins, career, actividades, telefonía Twilio, auth, admin). Ese núcleo limpio es la base para **reconstruir el mejor CRM de Propyte**.

Decisiones de producto tomadas con Luis (2026-06-09):
1. **Hub = dueño único** del catálogo inmobiliario (desarrollos/unidades) y del sync Zoho de catálogo. El CRM nuevo **solo consume catálogo en lectura** vía API del Hub.
2. **Todo Meta (Ads + Leads) vive en Hub.** El CRM nuevo queda libre de Meta.
3. **Plan formal antes de tocar código** (este documento).

## 2. Goals

- Dejar `propyte-crm` sin ningún subsistema de catálogo, Zoho-catálogo, captura pública, robots, ni Meta — verificable: 0 rutas/API/modelos/workflows de esas áreas.
- Que toda actividad **activa** hoy en CRM siga funcionando tras la migración: o porque ya la cubre el Hub, o porque se portó al Hub, o porque es core y permanece.
- Definir y publicar un **contrato de API de catálogo Hub→CRM** (solo lectura) para que el CRM nuevo ligue deals a desarrollos/unidades sin duplicar datos.
- Completar en Hub la **reconciliación Meta Leads** (matching Zoho↔Meta, discrepancias, export) hoy solo en CRM.
- Reubicar los 5 GitHub Actions de robots (+ secrets) al repo Hub, corriendo igual que hoy (cada 6h / diario / manual), sin reescritura de lógica.
- Que `propyte-crm` compile, despliegue y opere el núcleo CRM con su sidebar depurado al final de la migración.

## 3. Non-Goals

- **NO** se reconstruye el CRM nuevo en este spec. Esto solo deja la base limpia; el rebuild es un proyecto aparte.
- **NO** se rediseña ni se toca la lógica interna de sync Zoho del Hub (`/zoho-review`, `/cron/sync-zoho`) — ya funciona, es autoritativa.
- **NO** se migra data histórica de Prisma (`propyte_crm.*`) a Supabase salvo donde sea estrictamente necesario (Meta Leads). Catálogo de desarrollos/unidades del Hub ya es la fuente; las tablas `developments`/`units` de Prisma se consideran descartables.
- **NO** se cambia el modelo de auth (NextAuth contra `propyte_crm.users`) — sigue igual; el Hub ya depende de esa tabla.
- **NO** se rota el `CRON_SECRET` dentro de este spec (se deja como tarea/handoff a Luis), solo se documenta el impacto.

## 4. Context y constraints

### Estado actual

**propyte-crm** (Next 14, Prisma, schema `propyte_crm`):
- Sidebar activo (`src/components/layout/sidebar.tsx`): Dashboard, Contactos, Pipeline, Desarrollos, Comisiones, Reportes, Meta Ads, Meta Leads, Walk-ins, Sync Drive, Zoho Aprobaciones, Zoho Sync, Admin, (Career sin link).
- Robots `src/robots/{01-classifier,02-images,04-geo,05-ai-content,shared}` + workflows `.github/workflows/robot-0{1,2,4,5}-*.yml` y `refresh-rental-estimates.yml`. **Escriben solo a `real_estate_hub` (Supabase), cero acoplamiento a Prisma CRM** (usan `src/robots/shared/db.ts` con DATABASE_URL al Hub).
- Zoho catálogo: `src/lib/zoho/{client,sync-engine,field-maps,types}.ts`, rutas `src/app/api/zoho/*`, dashboards `(dashboard)/zoho-sync` y `(dashboard)/zoho-approvals`. Lee/escribe `real_estate_hub.Propyte_desarrollos/unidades/desarrolladores` + tablas `Propyte_zoho_*`.
- Captura: público `src/app/captura/[token]`, API `src/app/api/captura/*`, admin `(dashboard)/developments/captura`, libs `src/lib/intake/*`, modelos Prisma `IntakeLink`/`IntakeSubmission`, bucket `intake-quarantine`. Escribe catálogo a Hub vía service role tras aprobación.
- Meta Ads: `(dashboard)/meta-ads/*`, `src/app/api/meta-ads/*`, `src/server/meta-ads.ts`, `src/lib/meta/{client,types,capi}.ts`, modelos `MetaAdAccount`/`MetaCampaignCache`/`MetaDailyInsight`.
- Meta Leads: `(dashboard)/meta-leads/*`, `src/app/api/meta-leads/*`, `src/server/meta-leads.ts`, modelo `MetaLead`. Reconcilia contra `real_estate_hub.Propyte_zoho_leads`.
- CAPI: `src/lib/meta/capi.ts`, `src/app/api/meta-ads/capi`, disparado por `src/app/api/webhooks/zapier/contacts`.
- Sync Drive/Dropbox: `(dashboard)/sync`, `src/app/api/sync/*`, modelos `MonitoredFolder`/`SyncJob`/`SyncFile`/`SyncLog`. Escribe a Prisma `developments`/`units`.
- Núcleo CRM (se queda): contacts, pipeline/deals, commissions, walk-ins, career, activities, twilio (+ webhooks/twilio), dashboard, auth, notifications, admin/users, messages.

**Propyte_hub** (Next 15, NextAuth v5 contra `propyte_crm.users`, Supabase `real_estate_hub` + service_role, guards en `src/lib/api-guard.ts`):
- Zoho: `/zoho-review` + `/api/zoho-*` + `/api/cron/sync-zoho(-users)` + `src/lib/zoho/*` + `src/lib/reports/connectors/zoho/*`. ~95%, autoritativo. Tablas `Propyte_zoho_pending_changes/deletes`, `zoho_outbound_log`.
- Captura v2: `/captura/{token}`, `/api/intake/*` + `/api/public/intake/*`, admin `/desarrollos/captura`. ~90%, desplegada 2026-06-04.
- Desarrollos/Unidades: `/desarrollos`, `/unidades` + `/api/record`, `/api/bulk`, `/api/unidades/bulk`, `src/lib/fields-config.ts`. ~98%.
- Meta Ads: parcial en `/reportes/kpis` + `src/lib/reports/connectors/meta/*` + `/api/cron/sync-ads`. ~80%.
- Meta Leads matching: solo captura básica (`/api/leads`, `/api/ingest/meta-ads`, `/nativa/leads`). ~40%, **sin lógica de reconciliación**.
- Genesis status: read-only (`src/lib/status-canonical.ts`); no hay robot de sync en el repo Hub (los robots viven en CRM hoy).
- Cron infra madura: `/api/cron/*` guard por `CRON_SECRET`, log unificado `Propyte_sync_log`, despliegue main→GH Actions→Hostinger PM2.

### Constraints

- Hub y CRM comparten la **misma Supabase `oaijxdpevakashxshhvm`** (Hub: `real_estate_hub`; CRM: `propyte_crm`). Auth del Hub depende de `propyte_crm.users` → **no romper esa tabla**.
- **Doble sync Zoho de catálogo es peligroso**: el sync-engine del CRM y el del Hub pueden pisarse y/o saturar pg_net. Apagar el del CRM **antes** de quitar código, confirmando que el del Hub cubre todo.
- Triggers de push saliente a Zoho usan guard `last_source` (`zoho_*`/`bulk_admin`/`migration`); cualquier escritura masiva durante la migración debe respetarlo.
- GitHub Actions de robots usan secrets `SUPABASE_DB_PASSWORD`, `BANXICO_API_TOKEN`, `ANTHROPIC_API_KEY` → recrear en el repo Hub antes de mover los workflows.
- `CRON_SECRET` está pendiente de rotación (expuesto 2026-05-29) y lo comparten varios endpoints de ambos repos.
- Despliegue de ambos: push `main` → GitHub Actions → SCP Hostinger → PM2.

### Stakeholders

Luis (marketing/coordinación, dueño de decisiones), Felipe (mpgenesis/`public.properties`, fuente de robots).

## 5. Requirements

### 5.1 Funcionales

- [ ] **F1.** Apagar el sync Zoho de catálogo del CRM sin perder cobertura: confirmar paridad funcional con el Hub (`/zoho-review`, `/cron/sync-zoho`) y desactivar el cron/endpoint del CRM antes de borrar código.
- [ ] **F2.** Eliminar de `propyte-crm` rutas, API, libs y modelos de: Zoho catálogo, captura pública, Meta Ads, Meta Leads, CAPI, sync Drive/Dropbox, y robots — solo después de su contraparte en Hub esté confirmada.
- [ ] **F3.** Reubicar los 5 workflows de robots + `src/robots/*` al repo Hub, con secrets recreados, ejecutando con el mismo schedule. Verificar 1 corrida verde de cada uno.
- [ ] **F4.** Portar a Hub la reconciliación Meta Leads: ingesta de leads de formularios Meta, matching contra `Propyte_zoho_leads` (email/phone), estados PENDING/MATCHED/MISSING_IN_CRM/DUPLICATE, vista de discrepancias, filtro WhatsApp, export CSV. Tabla destino en `real_estate_hub`.
- [ ] **F5.** Consolidar Meta Ads en Hub: cubrir los dashboards que hoy da el CRM (campaigns/ads/audiences/overview) o confirmar que `/reportes/kpis` los reemplaza; mover CAPI + el webhook Zapier de contactos que lo dispara.
- [ ] **F6.** Publicar **API de catálogo Hub→CRM (solo lectura)**: endpoints para listar/obtener desarrollos y unidades (id, nombre, slug, precios, estado, plaza, fotos) que el CRM nuevo consumirá para ligar deals. Autenticado (API key o sesión).
- [ ] **F7.** Depurar el sidebar y la navegación del CRM para reflejar solo el núcleo restante.
- [ ] **F8.** Dejar `propyte-crm` compilando (`next build`) y desplegable con solo el núcleo CRM.

### 5.2 No funcionales

- **Seguridad:** ningún endpoint nuevo del Hub expone escritura sin guard; el API de catálogo es read-only y autenticado. No secrets en código.
- **Datos:** cero pérdida de datos vivos. Antes de borrar tablas Prisma, confirmar que su contenido (a) no es fuente de verdad o (b) ya está en Supabase. `MetaLead` debe migrar su data si tiene histórico útil.
- **Continuidad:** sin ventana en la que el sync Zoho quede apagado en ambos lados, ni en la que los robots no corran.
- **Reversibilidad:** cada fase en su rama; los borrados grandes en commits aislados y revertibles.

## 6. Approach / Arquitectura propuesta

Migración **por fases, de menor a mayor riesgo**, cada una en rama propia, con verificación antes de avanzar. Principio: **primero confirmar/crear el destino en Hub, luego apagar en CRM, luego borrar código.**

### Fase 0 — Preparación y red de seguridad
- Inventariar secrets de GH Actions usados por robots y confirmar acceso para recrearlos en el repo Hub.
- Verificar que el cron Zoho del CRM **no** esté agendado en Hostinger (un agente lo reportó sin cron Vercel; confirmar que no hay job externo llamándolo). Documentar quién dispara hoy `/api/zoho/sync/cron` del CRM.
- Snapshot/conteo de filas de tablas Prisma a descartar (`developments`, `units`, `MonitoredFolder`, `SyncJob/File/Log`, `IntakeLink/Submission`, `MetaLead`, `Meta*`) para decidir migración vs descarte.

### Fase 1 — Robots (bajo riesgo, sin reescritura)
- Copiar `src/robots/*` + `.github/workflows/robot-0{1,2,4,5}-*.yml` + `refresh-rental-estimates.yml` al repo Hub.
- Recrear secrets en el repo Hub. Ajustar paths/`package.json` scripts (`robot:01`…) en Hub.
- Correr cada workflow 1 vez (dispatch manual) → verde. **Solo entonces** deshabilitar/borrar los del CRM.

### Fase 2 — Apagar duplicados ya cubiertos por Hub
- **Zoho catálogo:** confirmar paridad (F1). Apagar endpoint/cron CRM. Borrar `src/lib/zoho/*`, `api/zoho/*`, `(dashboard)/zoho-sync`, `(dashboard)/zoho-approvals`, links del sidebar.
- **Captura:** confirmar captura v2 del Hub cubre el caso. Borrar `app/captura`, `api/captura/*`, `lib/intake/*`, `(dashboard)/developments/captura`, modelos `IntakeLink`/`IntakeSubmission`, script `intake-cleanup-quarantine`.

### Fase 3 — Meta a Hub (trabajo real)
- **Meta Leads (F4):** portar `server/meta-leads.ts` + lógica de matching a Hub; crear tabla `real_estate_hub.meta_leads` (o equivalente); reconstruir vistas overview/discrepancies/whatsapp/export en Hub; migrar data de `MetaLead` si aplica. Verificar matching contra `Propyte_zoho_leads`.
- **Meta Ads (F5):** decidir reuse de `/reportes/kpis` vs portar dashboards dedicados; mover `lib/meta/*` necesario; mover CAPI + webhook Zapier de contactos.
- Apagar y borrar en CRM: `(dashboard)/meta-ads/*`, `(dashboard)/meta-leads/*`, `api/meta-ads/*`, `api/meta-leads/*`, `server/meta-*.ts`, `lib/meta/*`, `webhooks/zapier/*` (los que aplique), modelos `Meta*`.

### Fase 4 — Sync Drive/Dropbox a Hub (mayor esfuerzo)
- Portar pipeline `MonitoredFolder→SyncJob→SyncFile→SyncLog` + `api/sync/*` + `(dashboard)/sync` a Hub, reescribiendo persistencia de Prisma a Supabase.
- Migrar registros de carpetas monitoreadas vivos. Apagar y borrar en CRM.

### Fase 5 — Contrato API de catálogo Hub→CRM (F6)
- En Hub: endpoints read-only `GET /api/catalog/developments`, `GET /api/catalog/developments/:id`, `GET /api/catalog/units?developmentId=` (campos mínimos para ligar deals). Auth por API key.
- En CRM: capa cliente que consume ese API; reemplazar lecturas a Prisma `developments`/`units`. Borrar esos modelos Prisma una vez migradas las lecturas (las FKs de `Deal`→development/unit pasan a guardar IDs del Hub).

### Fase 6 — Limpieza final del CRM
- Depurar sidebar/nav (F7), `prisma/schema.prisma` (dejar solo modelos core), `.env.example`, dependencias huérfanas (googleapis, meta SDK, etc.).
- `next build` verde (F8). Desplegar. Documentar estado final.

### Decisiones clave / alternativas descartadas
- **Apagar-antes-de-borrar** (vs borrar directo): elegido para evitar ventana sin sync y permitir rollback.
- **Catálogo vía API read-only** (vs CRM lee Supabase `real_estate_hub` directo): API explícita desacopla y da contrato estable; evita que el CRM dependa del schema interno del Hub.
- **Descartar tablas Prisma de catálogo** (vs migrarlas): el Hub ya es fuente de verdad; migrar duplicaría.

## 7. Acceptance Criteria

- [ ] `propyte-crm` no contiene rutas, API, libs, modelos ni workflows de: Zoho catálogo, captura, Meta (Ads/Leads/CAPI), sync Drive/Dropbox, robots (grep limpio).
- [ ] Los 5 robots corren desde el repo Hub con ≥1 corrida verde cada uno; los del CRM están deshabilitados/borrados.
- [ ] Reconciliación Meta Leads funciona en Hub (matching + discrepancias + export) con paridad a la del CRM.
- [ ] El sync Zoho de catálogo corre **solo** desde el Hub; ninguna doble escritura.
- [ ] Existe y responde el API de catálogo Hub→CRM (read-only, autenticado) y el CRM lo consume para ligar deals.
- [ ] `next build` del CRM verde; sidebar solo con núcleo; despliegue OK.
- [ ] Cero pérdida de datos vivos (verificado con conteos pre/post).

## 8. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Doble sync Zoho (CRM+Hub) se pisan / saturan pg_net | M | H | Apagar cron/endpoint CRM y confirmar paridad antes de borrar; respetar `last_source` |
| Robots dejan de correr al mover repo (secrets/paths) | M | H | Correr 1 dispatch verde por robot en Hub antes de deshabilitar en CRM |
| Pérdida de data al borrar modelos Prisma (`MetaLead`, sync, intake) | M | H | Conteos + export previo; migrar `MetaLead` si tiene histórico; descartar solo lo confirmado redundante |
| FKs de `Deal`→Development/Unit rotas al quitar catálogo de Prisma | M | M | Migrar a IDs del Hub vía API antes de borrar modelos; mantener columna id |
| `CRON_SECRET` compartido/expuesto se filtra más al mover endpoints | M | M | Documentar y agendar rotación con Luis; no commitear secrets |
| Meta Ads de `/reportes/kpis` no cubre lo que daban los dashboards del CRM | M | M | Comparar features antes de borrar; portar dashboards faltantes |
| Sesiones paralelas de Luis tocan estos repos | M | M | Verificar mtime antes de commit/checkout; ramas aisladas; `git add` específico |

## 9. Open Questions

- **OQ1.** ¿Quién/qué dispara hoy el sync Zoho del CRM (`/api/zoho/sync/cron`)? ¿Hay un cron externo activo o ya está muerto de facto? (define urgencia de Fase 2-Zoho)
- **OQ2.** Meta Ads: ¿`/reportes/kpis` del Hub ya te basta, o quieres portar los dashboards dedicados (campaigns/ads/audiences/gallery) del CRM tal cual?
- **OQ3.** ¿`MetaLead` (Prisma) tiene histórico que debamos migrar a Supabase, o se puede regenerar desde Meta API y arrancar limpio en Hub?
- **OQ4.** Webhooks Zapier (`/api/webhooks/zapier/{contacts,deals,activities}`): contacts dispara CAPI → va a Hub. ¿deals y activities siguen alimentando el CRM core (se quedan) o también se replantean?
- **OQ5.** El sync Drive/Dropbox (Fase 4): ¿sigue en uso activo (carpetas monitoreadas vivas) o está de facto reemplazado por los robots de mpgenesis y se puede simplemente apagar sin portar?
- **OQ6.** ¿Rotamos `CRON_SECRET` como parte de este proyecto (tú lo ejecutas) o lo dejamos fuera de alcance?

## 10. Plan de tareas (preliminar)

- [ ] **T0.1** Documentar disparador real del cron Zoho del CRM (OQ1) y conteos de filas de tablas Prisma candidatas a descarte — `prisma/`, Supabase
- [ ] **T0.2** Inventariar y conseguir acceso a secrets de GH Actions de robots para recrearlos en repo Hub — `.github/workflows/`
- [ ] **T1.1** Copiar `src/robots/*` + workflows robot a repo Hub; ajustar scripts `package.json` y paths — repo Hub
- [ ] **T1.2** Recrear secrets en repo Hub y correr 1 dispatch verde por robot (01/02/04/05 + rental-estimates) — repo Hub
- [ ] **T1.3** Deshabilitar/borrar workflows + `src/robots/*` del CRM — `propyte-crm`
- [ ] **T2.1** Confirmar paridad Zoho catálogo Hub vs CRM; apagar cron/endpoint CRM — `api/zoho/*`
- [ ] **T2.2** Borrar Zoho catálogo del CRM: `lib/zoho/*`, `api/zoho/*`, `(dashboard)/zoho-sync`, `(dashboard)/zoho-approvals`, sidebar — `propyte-crm`
- [ ] **T2.3** Confirmar captura v2 del Hub; borrar captura del CRM: `app/captura`, `api/captura/*`, `lib/intake/*`, `(dashboard)/developments/captura`, modelos `IntakeLink/Submission` — `propyte-crm`
- [ ] **T3.1** Crear tabla destino Meta Leads en `real_estate_hub` + portar `server/meta-leads.ts` y matching a Hub — repo Hub
- [ ] **T3.2** Reconstruir UI Meta Leads en Hub (overview/discrepancies/whatsapp/export) + migrar data `MetaLead` si aplica — repo Hub
- [ ] **T3.3** Consolidar Meta Ads en Hub (reuse `/reportes/kpis` o portar dashboards) + mover CAPI + webhook Zapier contacts — repo Hub
- [ ] **T3.4** Borrar Meta del CRM: `(dashboard)/meta-ads/*`, `(dashboard)/meta-leads/*`, `api/meta-ads/*`, `api/meta-leads/*`, `server/meta-*.ts`, `lib/meta/*`, modelos `Meta*`, webhooks Zapier que apliquen — `propyte-crm`
- [ ] **T4.1** Portar pipeline Drive/Dropbox a Hub (Supabase persistence) o apagarlo si está en desuso (OQ5) — repo Hub / `propyte-crm`
- [ ] **T4.2** Migrar carpetas monitoreadas vivas; borrar `api/sync/*`, `(dashboard)/sync`, modelos `MonitoredFolder/SyncJob/SyncFile/SyncLog` del CRM — `propyte-crm`
- [ ] **T5.1** Implementar API de catálogo read-only en Hub (`/api/catalog/developments`, `/:id`, `/units`) con auth — repo Hub
- [ ] **T5.2** En CRM: cliente que consume el API; reemplazar lecturas Prisma `developments`/`units`; ligar `Deal` a IDs del Hub; borrar modelos `Development`/`Unit` de Prisma — `propyte-crm`
- [ ] **T6.1** Depurar sidebar/nav, `prisma/schema.prisma` (solo core), `.env.example`, deps huérfanas — `propyte-crm`
- [ ] **T6.2** `next build` verde + deploy + documentar estado final del CRM limpio — `propyte-crm`
- [ ] **T6.3** (handoff Luis) Rotar `CRON_SECRET` si entra en alcance (OQ6)
