# Task Manager — propyte-crm (Zoho sync + migración a Hub)

> Última actualización: 2026-06-09 (spec de migración CRM→Hub aprobado por Luis).
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
- [ ] **T3.1** Tabla Meta Leads en `real_estate_hub` + portar matching (`server/meta-leads.ts`) a Hub
- [ ] **T3.2** UI Meta Leads en Hub (overview/discrepancies/whatsapp/export) + migrar data `MetaLead` si aplica (OQ3)
- [ ] **T3.3** Consolidar Meta Ads en Hub (OQ2: reuse `/reportes/kpis` vs portar dashboards) + CAPI + webhook Zapier contacts
- [ ] **T3.4** Borrar Meta del CRM — depende de T3.1–T3.3
- [ ] **T4.1** Sync Drive/Dropbox: portar a Hub o apagar si en desuso (OQ5)
- [ ] **T4.2** Borrar `api/sync/*`, `(dashboard)/sync`, modelos sync del CRM — depende de T4.1
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
