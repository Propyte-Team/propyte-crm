# Spec: Propyte Own CRM — base NextCRM + vertical real estate

> Estado: **draft v1.0** | Fecha: 2026-05-12 | Proyecto: propyte-crm-base (nuevo)
>
> **Decisión arquitectónica:** Adoptar [pdovhomilja/nextcrm-app](https://github.com/pdovhomilja/nextcrm-app) (MIT, Next.js 16 + React 19 + Postgres + Prisma 7 + shadcn/ui) como **esqueleto** de un CRM operativo Propyte propio, sustituyendo gradualmente a Zoho CRM. El vertical real estate se construye encima — combinando lo que ya existe en `real_estate_hub` (Supabase) con cherry-pick de features RE-specific extraídas de los CRMs verticales open source.
>
> **Por qué NO Twenty:** Audit de seguridad detectó 4 Críticos + 9 Altos (informe en `~/Desktop/cyber-neo-report-twenty-crm-2026-05-12.md`). Más allá de los findings, Twenty (21,654 archivos, 22 workspaces Nx, NestJS + TypeORM + GraphQL Federation) es 200x más grande que lo manejable para Propyte, con stack que no coincide con `crm.propyte.com` ni `hub.propyte.com`. Twenty descartado el 2026-05-12.
>
> **Por qué NextCRM:** Stack idéntico al actual de Propyte (Next.js 16, React 19, Tailwind 4, Postgres, Prisma 7, shadcn/ui). 1,435 commits, MIT license, activo (v0.12.1 publicada 2026-05-11). MCP server con 127 tools (integración Claude Code nativa). Tamaño manejable. Ya trae Accounts/Contacts/Leads/Opportunities/Targets/Contracts + facturación + email client + AI enrichment + audit logs — features que tomarían 3-6 meses construir desde cero.

## 1. Overview

Propyte hoy opera con **Zoho CRM** como sistema operativo del equipo comercial (20,915 leads históricos, 5+ comerciales, Assignment Rules activas). Coexiste con un ecosistema propio:

- **`crm.propyte.com`** — Next.js 14 + Prisma + Neon. Dashboards Meta Ads, webhook leads.
- **`hub.propyte.com`** — Next.js 16. Reports, Approval, Sync, Blog AI.
- **`real_estate_hub`** — schema Supabase con tablas `Propyte_desarrollos`, `Propyte_unidades`, `Propyte_champions`, view `v_units`, `Propyte_zoho_id_map` (30 triggers, 14 funciones).
- **`propyte-crm/src/lib/zoho`** — cliente OAuth + sync engine + rate limiter probado con 20K records.

Limitaciones del modelo Zoho actual:
- Licencias por seat (cuesta lineal con crecimiento del equipo).
- Customización limitada para flujos vertical inmobiliario (champion-unidad matching, KYC desarrollador, comisiones a brokers independientes).
- Datos viven en cloud externo (control limitado, no exportable masivo gratis).
- Quota API diaria (10K calls/día como techo).

Este spec propone migrar el **CRM operativo** a un sistema self-hosted basado en NextCRM, manteniendo `real_estate_hub` como source-of-truth del vertical inmobiliario y reusando el sync engine Zoho para migración gradual. **Sin tocar visualmente** los sitios públicos (`propyte.com`, `nativatulum.mx`) ni el plugin WordPress.

## 2. Goals

- **Reemplazar gradualmente Zoho** como CRM operativo del equipo comercial, sin breaking el flujo actual.
- **Reusar `real_estate_hub`** — el vertical inmobiliario ya construido en Supabase es source-of-truth de desarrollos/unidades/champions. NextCRM lee/escribe contra la misma instancia Postgres.
- **Adoptar NextCRM como esqueleto** del CRM core (contactos, pipelines, opportunities, facturación, email, audit logs) — evita reconstruir features genéricas.
- **Customizar el vertical real estate** combinando los modelos Propyte existentes + features cherry-picked de los CRMs verticales (Movin'In, microrealestate, eevan7a9).
- **Sync bidireccional con Zoho** durante F1/F2 para que el equipo opere en ambos sin perder datos.
- **Migración gradual de datos** — los 20K leads históricos de Zoho llegan vía sync engine existente, no requiere ETL one-shot.
- **Cero downtime** del flujo de captura web — el spec `web-forms-zoho-integration.md` v1.4 sigue funcionando; en F2 el `/api/leads` escribe a NextCRM además de Zoho.
- **Stack alineado** con `crm.propyte.com` y `hub.propyte.com` para que el equipo (Luis + colaboradores) pueda mantenerlo sin curva de aprendizaje nueva.

## 3. Non-Goals

- **No** reemplazar Zoho de un solo golpe — migración por fases F1 → F2 → F3 a lo largo de 3-6 meses.
- **No** migrar `crm.propyte.com` ni `hub.propyte.com` — estos sistemas siguen operando independientes, solo se integran vía API.
- **No** rebuildear el vertical inmobiliario desde cero — los modelos `Propyte_desarrollos`/`unidades`/`champions` quedan tal cual en `real_estate_hub`.
- **No** reescribir el sync engine Zoho — se reusa `propyte-crm/src/lib/zoho` adaptado al schema NextCRM.
- **No** tocar visualmente los sitios públicos.
- **No** auto-importar features de NextCRM que no agregan valor inmediato (E2B sandboxes, Inngest workflows complejos) — se activan cuando sean necesarias.
- **No** depender de servicios SaaS pagados nuevos (E2B es opt-in, MinIO local sustituye S3, Resend opt-in vs SMTP Hostinger).

## 4. Context y constraints

### Stack confirmado

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Runtime | Node.js | 24.x |
| Frontend | Next.js + React | 16 / 19 |
| Lenguaje | TypeScript | 5.x |
| Estilos | Tailwind CSS | 4 |
| UI lib | shadcn/ui | latest |
| Auth | Better Auth | 1.5.x |
| ORM | Prisma | 7.5 |
| DB | PostgreSQL | 17+ con `pgvector` |
| Background jobs | Inngest | latest |
| File storage | UploadThing / MinIO (S3-compat) | latest |
| Email | Nodemailer + SMTP Hostinger (alineado feedback) | 6.x |
| i18n | next-intl | 4 |
| AI | Anthropic Claude Sonnet 4.6 + opcional OpenAI embeddings | API |
| MCP | NextCRM MCP server (127 tools) | built-in |

### Constraints técnicos

- **Hosting:** Hostinger VPS (mismo que `propyte.com` y `crm.propyte.com`) + PM2 + Nginx, modo standalone (memoria existente `feedback_hostinger_nextjs.md`).
- **Supabase:** reuso de project ref `oaijxdpevakashxshhvm` (production). Schema `real_estate_hub` permanece intacto.
- **Email:** Nodemailer + SMTP Hostinger (`info@nativatulum.mx` primario, alias `reportes@propyte.com`) — no Resend (memoria `feedback_nodemailer_over_resend.md`).
- **Cron jobs:** crontab Linux Hostinger (NO Vercel cron — memoria `feedback_propyte_deploy_topology.md`).
- **Secrets:** env vars Hostinger, jamás en cliente. Cron secrets via archivo `-K` con permisos 600 (mismo patrón que el spec Zoho v1.4).
- **DDL en Supabase prod:** requiere autorización explícita (memoria `feedback_harness_blocks_prod_ddl.md`). Las migraciones Prisma se entregan a Luis como SQL para revisar.
- **Schema USAGE:** cualquier schema nuevo creado en Supabase requiere `GRANT USAGE TO anon` ANTES de RLS (memoria `feedback_supabase_schema_usage_grant.md`).
- **Stack alineado:** mismas convenciones que `Next_Propyte_web` y `hub.propyte.com` (memoria `project_propyte_hub.md`).

### Stakeholders

- **Luis Flores** (Marketing Coordinator, owner del proyecto) — toma decisión de migrar / coexistir / cancelar. Configura accesos.
- **Equipo comercial Propyte** (Felipe Luksic, Alejandro Zamudio, Maricela Diaz, Filiberto Arias, Conrad Alvarado, etc.) — usuarios finales del CRM operativo. Resistencia al cambio = riesgo principal.
- **Equipo Zoho** (administrador de la app SupabaseSync) — mantiene la coexistencia durante F1/F2.

### Decisiones previas registradas

- **Stack idéntico al de Next_Propyte_web + hub** — no se evalúan alternativas con stack distinto.
- **NO Twenty** — audit + tamaño desproporcionado (decisión 2026-05-12).
- **Zoho como source-of-truth durante F1+F2** — NextCRM consume datos via sync, no impone su modelo.
- **Migración por fases**, no big bang.

## 5. Requirements

### 5.1 Funcionales — Core CRM (heredados de NextCRM)

NextCRM aporta tal cual, sin modificación inicial:

- [ ] **REQ-F-01.** Módulos Account / Contact / Lead / Opportunity / Target / Contract funcionando con datos Propyte.
- [ ] **REQ-F-02.** Audit logs con soft-delete history en todas las entidades CRM.
- [ ] **REQ-F-03.** Email client IMAP/SMTP integrado (config Hostinger).
- [ ] **REQ-F-04.** Document management (upload, versioning, share links).
- [ ] **REQ-F-05.** Activity tracking (notes, calls, emails, meetings, tasks).
- [ ] **REQ-F-06.** Vector semantic search + unified keyword search vía `pgvector`.
- [ ] **REQ-F-07.** Reports con Tremor charts (Tickets abiertos, pipeline, lead source).
- [ ] **REQ-F-08.** Better Auth — login email + magic link + opcional Google OAuth (paridad con Zoho).
- [ ] **REQ-F-09.** i18n ES/EN/FR (NextCRM trae 4 idiomas; activar ES/EN para Propyte; FR para Nativa futuro).
- [ ] **REQ-F-10.** AI enrichment vía Claude Sonnet (research de leads, sugerencias de follow-up).
- [ ] **REQ-F-11.** MCP server: 127 tools expuestos a Claude Code para automatizaciones del equipo Luis.

### 5.2 Funcionales — Vertical real estate (Propyte-custom)

Extender NextCRM con los siguientes módulos vertical:

- [ ] **REQ-V-01.** Módulo **Developments** (Desarrollos inmobiliarios) — mapea a `real_estate_hub.Propyte_desarrollos`. Campos: nombre, slug, ciudad, tipo (vertical/horizontal/mixto), estado (preventa/construcción/entregado), unidades totales, unidades disponibles, fecha inicio, fecha entrega. Vinculado N:N con Opportunities.
- [ ] **REQ-V-02.** Módulo **Units** (Unidades) — mapea a `real_estate_hub.Propyte_unidades` vía vista `v_units`. Campos: id, development_id, tipo (depto/casa/local/terreno), m², recámaras, baños, precio, estado (disponible/reservada/vendida), GPS lat/lng. Vinculado 1:N con Opportunities (1 unidad puede tener varias Opportunities históricas).
- [ ] **REQ-V-03.** Módulo **Champions** (Brokers independientes / afiliados) — mapea a `real_estate_hub.Propyte_champions`. Rol distinto de "Agent" (empleado interno) y "Broker" externo. Campos: id, name, email, phone, type (afiliado/embajador/empresa), tier, comission_split %. Vinculado N:N con Developments (champion comercializa N desarrollos).
- [ ] **REQ-V-04.** Módulo **Showings** (Visitas a propiedad) — nuevo. Campos: unit_id, contact_id (cliente), champion_id o agent_id, fecha, status (programada/realizada/cancelada), notas, attendees (lista). Calendar view tipo Movin' In. Vinculado al Opportunity.
- [ ] **REQ-V-05.** Lead pipeline vertical RE — Lead stages extendidos: `Nuevo`, `Contactado`, `Visita programada`, `Visita realizada`, `Cotización enviada`, `Reserva`, `Contrato firmado`, `Cerrado ganado`, `Cerrado perdido`. Configurable por tipo de desarrollo.
- [ ] **REQ-V-06.** Property interest tracking — cada Lead/Contact lleva lista de `Properties of Interest` (Units favoritas, propiedades cotizadas).
- [ ] **REQ-V-07.** Document templates RE — contrato de promesa de compraventa, KYC desarrollador, ficha técnica, propuesta comercial, reporte de cierre. Templating con `{{contact.firstName}}` etc. (microrealestate aporta el concepto).
- [ ] **REQ-V-08.** Commission tracking — cada Opportunity cerrado calcula comisión = monto × split. Vista "Comisiones pendientes" por champion/agent. (Movin'In aporta el concepto de hierarquía agency-broker).
- [ ] **REQ-V-09.** Map view — Leaflet con OpenStreetMap (o Google Maps si Luis prefiere). Visualizar desarrollos + unidades disponibles en mapa. Filtros por ciudad, tipo, rango de precio. (eevan7a9/microrealestate aportan el patrón).
- [ ] **REQ-V-10.** Property gallery — imágenes multi-resolución, vista 360° opcional. UploadThing/MinIO storage. (todos los verticales lo incluyen).
- [ ] **REQ-V-11.** Multi-tipo de propiedad — residencial / comercial / industrial / terreno. Cada tipo con sub-formulario de campos distintos.
- [ ] **REQ-V-12.** Public listing endpoint API — exposición read-only de `/api/listings` y `/api/listings/[id]` para que `propyte.com` (Next_Propyte_web) y plugin WordPress lean del CRM en vez de Supabase directo. Mantiene Supabase como cache.

### 5.3 Funcionales — Integración con stack actual

- [ ] **REQ-I-01.** **Bridge Supabase `real_estate_hub`** — Prisma schema importa los modelos existentes vía `@@map(name: "Propyte_desarrollos", schema: "real_estate_hub")` (Prisma 7 soporta multi-schema). Sin migración de datos.
- [ ] **REQ-I-02.** **Sync Zoho bidireccional** — adaptar `propyte-crm/src/lib/zoho` para NextCRM. Mapping `ZohoLead → NextCRM.Lead` con persistencia idempotente por `zoho_lead_id` UNIQUE.
- [ ] **REQ-I-03.** **Endpoint `/api/leads`** del spec `web-forms-zoho-integration.md` v1.4 — durante F2 escribe a **NextCRM primero** (source-of-truth nuevo), y Zoho como secundario vía el mismo sync engine. Reusa el hardening v1.4.
- [ ] **REQ-I-04.** **Plugin WordPress** — sigue leyendo de Supabase (sin cambio); NextCRM escribe a Supabase como cache via Prisma trigger.
- [ ] **REQ-I-05.** **`crm.propyte.com` Meta Ads dashboard** — sigue operando independiente; en F3 puede consumir API `/api/leads` de NextCRM en vez de Neon directo.
- [ ] **REQ-I-06.** **`hub.propyte.com` reports module** — sigue operando independiente; opcional integración con MCP de NextCRM para reportes cruzados.
- [ ] **REQ-I-07.** **Assignment Rules** — Zoho rotation se replica en NextCRM con un Inngest job que aplica reglas configurables por Luis (lead source, ciudad, tipo de desarrollo) → asigna `owner_id`.

### 5.4 No funcionales

- **Performance:** TTFB ≤ 500ms p95 en CRUD básico. Queries con cache Redis cuando aplique.
- **Disponibilidad:** 99.5% durante F2 (coexistencia tolera ventanas de mantenimiento); 99.9% en F3.
- **Seguridad (heredada del hardening v1.4 del spec Zoho):** rate limit per-IP + global quota, honeypot constant-time, sanitize PII en logs/errors, Zod estricto, timing-safe secrets, SECURITY DEFINER hardening, cookies httpOnly+secure+sameSite, helmet básico.
- **Backup:** Supabase backup diario nativo (ya configurado); export Postgres semanal a Drive (reusar service account de `hub.propyte.com`).
- **Observabilidad:** Sentry (project nuevo, propyte-crm-base), `pm2 logs` grepables, logs structured JSON.
- **Migration safety:** F1 y F2 son **reversibles** (Zoho sigue siendo source-of-truth canónico). F3 es punto de no retorno — antes de F3, snapshot completo + freeze window.

## 6. Arquitectura

### 6.1 Topología

```
┌─────────────────────────────────────────────────────────┐
│  CRM operativo (NextCRM fork)                           │
│  propyte-crm-base                                       │
│  hostname: crm-base.propyte.com (Hostinger PM2)         │
│  ├─ NextCRM core (Accounts/Contacts/Leads/Opps/...)     │
│  └─ Propyte vertical modules (Developments/Units/...)   │
└─────────────────────────────────────────────────────────┘
                ↓ Prisma ↓
┌─────────────────────────────────────────────────────────┐
│  PostgreSQL (Supabase, ref oaijxdpevakashxshhvm)        │
│  ├─ public.* (NextCRM schema)                           │
│  │     accounts, contacts, leads, opportunities, ...    │
│  └─ real_estate_hub.* (vertical Propyte)                │
│        Propyte_desarrollos, Propyte_unidades,           │
│        Propyte_champions, v_units, Propyte_zoho_id_map  │
└─────────────────────────────────────────────────────────┘
       ↑                  ↓ sync                ↑
┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ propyte.com  │  │  Zoho CRM        │  │  hub.propyte.com │
│ web forms    │  │  (read-only F3,  │  │  reports module  │
│ /api/leads   │  │   bidireccional  │  │  (sin cambio)    │
│ (spec v1.4)  │  │   F1+F2)         │  │                  │
└──────────────┘  └──────────────────┘  └──────────────────┘
       ↓
┌──────────────────┐
│ WordPress        │
│ plugin           │
│ (lee Supabase    │
│  sin cambio)     │
└──────────────────┘
```

### 6.2 Modelos extendidos (Prisma schema delta sobre NextCRM)

NextCRM aporta el schema base. Agregamos los siguientes modelos vertical en `prisma/schema-propyte.prisma`:

```prisma
// Bridge a la tabla existente en Supabase real_estate_hub
model Development {
  id              String        @id @default(cuid())
  name            String
  slug            String        @unique
  city            String
  type            DevelopmentType    // VERTICAL / HORIZONTAL / MIXED
  status          DevelopmentStatus  // PREVENTA / CONSTRUCCION / ENTREGADO
  totalUnits      Int
  availableUnits  Int
  startDate       DateTime?
  deliveryDate    DateTime?
  lat             Decimal?      @db.Decimal(10, 7)
  lng             Decimal?      @db.Decimal(10, 7)
  zohoRecordId    String?       @unique  // bridge a Propyte_zoho_id_map
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  units           Unit[]
  opportunities   Opportunity[] // relación many-to-many vía join
  champions       ChampionOnDevelopment[]
  @@map(name: "Propyte_desarrollos")
  @@schema("real_estate_hub")
}

model Unit {
  id              String      @id @default(cuid())
  developmentId   String
  type            PropertyType    // APARTMENT / HOUSE / LAND / COMMERCIAL
  title           String      // ATENCIÓN: la view v_units expone `title`, no `name` (memoria v_units_idiosyncrasies)
  surface         Decimal     @db.Decimal(10, 2)
  bedrooms        Int?
  bathrooms       Decimal?    @db.Decimal(3, 1)
  price           Decimal     @db.Decimal(14, 2)
  currency        String      @default("MXN")
  status          UnitStatus  // AVAILABLE / RESERVED / SOLD
  lat             Decimal?    @db.Decimal(10, 7)  // memoria: NUMERIC se serializa como string en JS, castear antes de Google Maps
  lng             Decimal?    @db.Decimal(10, 7)
  development     Development @relation(fields: [developmentId], references: [id])
  showings        Showing[]
  opportunities   Opportunity[] // relación 1:N
  @@map(name: "Propyte_unidades")
  @@schema("real_estate_hub")
}

model Champion {
  id              String                @id @default(cuid())
  name            String
  email           String                @unique
  phone           String?
  type            ChampionType    // AFFILIATE / AMBASSADOR / COMPANY
  tier            ChampionTier    // BRONZE / SILVER / GOLD / PLATINUM
  commissionSplit Decimal               @db.Decimal(5, 2)  // % de comisión que toca al champion
  isActive        Boolean               @default(true)
  developments    ChampionOnDevelopment[]
  showings        Showing[]
  opportunities   Opportunity[]
  @@map(name: "Propyte_champions")
  @@schema("real_estate_hub")
}

model ChampionOnDevelopment {
  championId      String
  developmentId   String
  customSplit     Decimal? @db.Decimal(5, 2)  // override del split default del champion
  champion        Champion @relation(fields: [championId], references: [id])
  development     Development @relation(fields: [developmentId], references: [id])
  @@id([championId, developmentId])
  @@schema("real_estate_hub")
}

model Showing {
  id              String        @id @default(cuid())
  unitId          String
  contactId       String        // FK a public.contacts (NextCRM core)
  championId      String?       // si comercializa un champion
  ownerId         String?       // si lo lleva un agente interno
  scheduledAt     DateTime
  status          ShowingStatus // SCHEDULED / COMPLETED / NO_SHOW / CANCELED
  notes           String?       @db.Text
  attendees       String[]      // emails/nombres adicionales
  createdAt       DateTime      @default(now())
  unit            Unit          @relation(fields: [unitId], references: [id])
  champion        Champion?     @relation(fields: [championId], references: [id])
  // contact y owner viven en schema public (NextCRM), Prisma 7 maneja cross-schema FK
  @@schema("real_estate_hub")
}

// Extensión del modelo Opportunity nativo de NextCRM
// (NextCRM ya tiene Opportunity; agregamos campos Propyte en una tabla satellite)
model OpportunityVertical {
  opportunityId   String         @id  // FK 1:1 a public.opportunities
  unitId          String?
  developmentId   String?
  championId      String?
  stage           PropyteLeadStage  // ver REQ-V-05
  commissionAmount Decimal?      @db.Decimal(14, 2)
  commissionPaid  Boolean        @default(false)
  contractSignedAt DateTime?
  closedReason    String?        // si LOST: razón
  unit            Unit?          @relation(fields: [unitId], references: [id])
  development     Development?   @relation(fields: [developmentId], references: [id])
  champion        Champion?      @relation(fields: [championId], references: [id])
  @@map(name: "opportunity_vertical")
  @@schema("public")
}
```

Enums:

```prisma
enum DevelopmentType { VERTICAL HORIZONTAL MIXED }
enum DevelopmentStatus { PRELAUNCH PREVENTA CONSTRUCCION ENTREGADO }
enum PropertyType { APARTMENT HOUSE LAND COMMERCIAL INDUSTRIAL }
enum UnitStatus { AVAILABLE RESERVED SOLD OFF_MARKET }
enum ChampionType { AFFILIATE AMBASSADOR COMPANY }
enum ChampionTier { BRONZE SILVER GOLD PLATINUM }
enum ShowingStatus { SCHEDULED COMPLETED NO_SHOW CANCELED }
enum PropyteLeadStage {
  NUEVO
  CONTACTADO
  VISITA_PROGRAMADA
  VISITA_REALIZADA
  COTIZACION_ENVIADA
  RESERVA
  CONTRATO_FIRMADO
  CERRADO_GANADO
  CERRADO_PERDIDO
}
```

> **Nota sobre multi-schema en Prisma 7:** habilitar `previewFeatures = ["multiSchema"]` en `generator client {}`. Los modelos con `@@schema("real_estate_hub")` requieren que el schema exista y que el role de Prisma tenga `USAGE` (memoria `feedback_supabase_schema_usage_grant.md`). Verificar antes de migrar.

### 6.3 Cherry-pick de features RE de los verticales

Inventario de features extraídas de los CRMs verticales open source, ordenadas por valor + esfuerzo:

| Feature | Origen | Categoría | Implementación en NextCRM fork | Esfuerzo |
|---------|--------|-----------|---------------------------------|----------|
| **Property listings con multi-tipo** (apt/casa/terreno/comercial) | eevan7a9 + Movin'In | Core RE | `Unit.type` enum (REQ-V-02 + V-11). Sub-form custom por tipo. | M |
| **Map view con Leaflet** | eevan7a9 | UI | Componente `<UnitsMap />` en shadcn dialog. Usar Leaflet (gratis, sin Google Maps API key). | M |
| **Geographic filtering** | Movin'In | Listing | Filtro `?city=&type=&minPrice=&maxPrice=` en `/api/listings`. | S |
| **Lead pipeline RE con stages custom** | implícito en todos | Core RE | `PropyteLeadStage` enum + UI tipo Kanban en NextCRM Opportunities (NextCRM ya tiene Kanban). | M |
| **Property interest tracking** | (gap en todos, lo aporta Propyte) | Lead mgmt | Tabla `contact_property_interest` N:N entre Contact y Unit. | S |
| **Showings/Visitas scheduler** | Movin'In ("Property scheduler") | Workflow RE | Módulo Showings (REQ-V-04). Vista calendar con `react-big-calendar`. | L |
| **Document templates con variables** | microrealestate | Documents | Reuso de NextCRM document module + agregar `{{handlebars}}` parsing. Templates seed: promesa CV, KYC, ficha, propuesta. | M |
| **Commission tracking** | Movin'In (agency model) | Financial | `OpportunityVertical.commissionAmount` + cron job para reportes. Vista "Comisiones pendientes". | M |
| **Agency/champion hierarchy** | Movin'In | Roles | Modelo `Champion` + `ChampionOnDevelopment` (REQ-V-03). | M |
| **Auto-notification system** | Movin'In | Comms | Inngest events (NextCRM ya trae Inngest). Trigger: showing scheduled, status change, contract signed. | S |
| **Multi-currency** | Movin'In | i18n | `Unit.currency` enum MXN/USD/EUR. NextCRM ya tiene multi-currency en invoicing. | S |
| **Property gallery con thumbnails** | todos | Media | UploadThing + Next.js Image. Soporte vista 360 opt-in (Krpano/Pannellum si Luis lo pide). | M |
| **Multi-language listings** | Movin'In | i18n | Reusar next-intl de NextCRM. Campo `Unit.descriptions` JSONB por locale. | M |
| **Inquiry → property direct submission** | eevan7a9 + Movin'In | Capture | El `/api/leads` v1.4 del spec Zoho ya soporta `property_inquiry` con `propertyId`. Reuso 1:1. | S (ya existe) |
| **Public listing API** | ResidenceCMS, Hozn | Integración | `/api/listings` y `/api/listings/[id]` read-only para WordPress + propyte.com. (REQ-V-12). | M |
| **Tier system para brokers** | Movin'In (agency type) | Roles | `Champion.tier` enum. UI badge en cada champion. | S |
| **Public agent profiles** | ResidenceCMS | Public site | Out of scope F1/F2; evaluar en F3 si propyte.com lo necesita. | (futuro) |
| **MLS integration** | mencionado como gap en todos | Listings | Out of scope — México no tiene MLS estándar. Skip. | — |
| **Social forum / vendor sharing** | Open House CRM | Networking | Out of scope — overhead vs valor bajo. Skip. | — |

> **Esfuerzo:** S=1-3 días, M=4-10 días, L=2-4 semanas. Total cherry-pick = ~3-4 meses para todo lo marcado S+M+L.

### 6.4 Sync Zoho ↔ NextCRM

Reusar `propyte-crm/src/lib/zoho/client.ts` (probado en producción con 20K records). Adaptaciones:

1. **Mapping** `ZohoLead → NextCRM.Lead` definido en nuevo módulo `src/lib/zoho/mapping.ts`:
   - `Last_Name` → `lastName` (+ `parseName` para split — reuso del helper del spec v1.4)
   - `Email` → `email` (UNIQUE en NextCRM; conflict → UPDATE)
   - `Lead_Source` → `source` (mapear "Sitio web" → `WEB`)
   - `Nombre_de_Campa_a` → custom field `campaignName`
   - `Tipo_de_Contacto` → custom field `contactType`
   - `Proyecto_de_Interes` → resolver `developmentId` vía `Propyte_zoho_id_map.zoho_record_id`
2. **Idempotencia:** tabla bridge `zoho_lead_sync` con `(zoho_id, nextcrm_id, last_synced_at, hash)`. Upsert por `zoho_id`.
3. **Direction:**
   - **F1:** Zoho → NextCRM (one-way read). Inngest job cada 15 min `import-zoho-leads`.
   - **F2:** NextCRM → Zoho (push de updates). Webhook desde NextCRM en Lead.update → Zoho API.
   - **F3:** NextCRM → Zoho (legacy archive only). Zoho deja de recibir leads nuevos.

### 6.5 Migración de datos históricos

20,915 leads en Zoho → NextCRM:
1. **No** big bang ETL. La migración ocurre via el sync engine de F1 (cada lead histórico se importa cuando el sync corre).
2. Inngest job `backfill-zoho-leads` corre 1 vez: paginar Zoho 200/página, importar en batch. ~105 batches × 5s = ~10 minutos.
3. Post-migración, verificar `count(zoho_lead_sync) ≥ 20,000`. Spot-check 50 leads aleatorios para validar mapping.

### 6.6 Alternativas descartadas

- **Construir desde cero con Next.js + Supabase.** Más control, pero 3-6 meses extra de trabajo solo para llegar al feature-parity de NextCRM. Descartado por ROI.
- **Adoptar `prolinkinfo/RealEstateCRM` (MERN).** Stack MongoDB no alinea con Postgres/Supabase. Migrar de Mongo a Postgres = trabajo adicional sin valor. Descartado.
- **Migrar features de microrealestate a fork.** El proyecto es solo landlord-tenant. Las features útiles (document templates) son ideas simples replicables, no código portable.
- **Adoptar EspoCRM Real Estate extension.** EspoCRM es PHP — fuera del stack Propyte. Descartado.
- **Coexistir con Zoho indefinidamente sin migrar.** Válido como decisión, pero entonces este spec no aplica.

## 7. Acceptance Criteria

### F1 — POC interno
- [ ] Fork de NextCRM existe en `Propyte-Team/propyte-crm-base` (GitHub).
- [ ] Clone local en `C:/Users/ptoral/Projects/Propyte/propyte-crm-base/` con build sin errores.
- [ ] `prisma db pull` lee tablas `real_estate_hub.*` exitosamente.
- [ ] Schema Prisma incluye los 6 modelos vertical (Development, Unit, Champion, ChampionOnDevelopment, Showing, OpportunityVertical) sin errores.
- [ ] `npm run dev` levanta NextCRM con Postgres Supabase + auth via Better Auth.
- [ ] Luis puede crear 1 Lead + 1 Account + 1 Opportunity manualmente en la UI.
- [ ] Vista `/units` muestra al menos 10 unidades reales de `real_estate_hub` leídas vía Prisma.
- [ ] MCP server responde a `list_tools` con 127 tools + tools propios Propyte agregados.

### F2 — Integración paralela
- [ ] Inngest job `import-zoho-leads` corre cada 15 min y persiste leads nuevos en NextCRM.
- [ ] `/api/leads` (spec Zoho v1.4) en `Next_Propyte_web` apunta a NextCRM como source primario + Zoho como fallback.
- [ ] Backfill histórico ejecutado — `count(zoho_lead_sync) ≥ 20,000`.
- [ ] Equipo comercial (Luis + 2 piloto) tiene acceso, login funcional.
- [ ] Pipeline RE custom (`PropyteLeadStage`) visible y editable.
- [ ] Reportes básicos: leads por source, conversion rate, pipeline value.
- [ ] Showings module operativo — agendar visita, marcar realizada/no-show.
- [ ] Document templates generan PDF de promesa CV y ficha técnica con datos reales.

### F3 — Cutover
- [ ] Equipo comercial completo migrado a NextCRM.
- [ ] Zoho en modo read-only (no recibe leads nuevos).
- [ ] `crm.propyte.com` Meta Ads dashboard consume `/api/leads` de NextCRM.
- [ ] Public listing API expuesto y consumido por `propyte.com` + WordPress plugin.
- [ ] Snapshot final de Zoho exportado a Drive (backup permanente).
- [ ] Plan de mantenimiento documentado (CVE patching, deps bumps, sync issues).
- [ ] Security audit completado (mismo flujo Cyber Neo) con risk score ≤ 20.

## 8. Riesgos y mitigaciones

| Riesgo | Prob | Impacto | Mitigación |
|---|---|---|---|
| Equipo comercial resiste el cambio | A | M | F2 con coexistencia 4-8 semanas. Training 1-on-1. Mantener Zoho UI accesible read-only en F3. |
| NextCRM upstream introduce breaking change | M | M | Fork pin a SHA específico. Bumps planeados mensualmente, no automático. Tests Playwright atrapan regresiones. |
| Schema `real_estate_hub` cambia (otro spec) | M | A | Prisma `db pull` antes de cada deploy. CI valida que el schema Prisma matchea Supabase. |
| Migración datos Zoho falla parcialmente | M | M | Idempotencia + retry. Diff post-backfill (leads en Zoho vs NextCRM por email). |
| Performance degrada con 20K leads + opportunities | L | M | Postgres tuning (indexes en email, source, stage). Vector search puede requerir partition. |
| Better Auth no soporta SSO Zoho | A | L | F1 acepta login email; SSO se evalúa en F3 si Luis lo pide. |
| Helmet/CSP rompe UI de NextCRM | M | M | Adoptar configuración helmet conservadora del spec Zoho v1.4. CSP strict solo en F3. |
| MCP tools exponen demasiada superficie | M | M | Audit pre-F2 de los 127 tools. Disable tools sensibles (delete entities, financial writes) hasta F3 con permisos granulares. |
| Costo Hostinger sube por carga adicional (Postgres + Redis + Inngest) | L | L | Supabase ya provee Postgres + Redis. Inngest cloud free tier hasta 50K events/mes (suficiente). |
| Sentry DSN nuevo se filtra en client bundle | L | L | Heredar patrón env vars del spec v1.4. Solo `NEXT_PUBLIC_SENTRY_DSN` es público (Sentry DSNs no son secret estricto). |
| **AI features (Claude enrichment) consumen quota inesperada** | M | M | Disable Claude enrichment por default. Activación per-user con `AI_ENABLED=true` env. Monitorear gasto en Anthropic Console. |
| **Decisión F3 prematura → cutover sin rollback** | L | A | F3 require: 4 semanas en F2 sin issues + checklist explícito + snapshot Zoho + freeze window 24h. |

## 9. Open Questions

> **Pre-implementación (necesarias antes de F1):**
>
> - **Q1.** ¿Luis autoriza fork público o privado de NextCRM en `Propyte-Team/propyte-crm-base`? El repo upstream es MIT, ambas opciones son legales.
> - **Q2.** ¿Usar la misma instancia Supabase (`oaijxdpevakashxshhvm`) o crear una nueva para el CRM? Mismo = simple + costo, nueva = aislamiento de cargas. Recomendación: misma instancia para F1/F2, evaluar split en F3 si performance lo amerita.
> - **Q3.** ¿Hostname propuesto `crm-base.propyte.com`? ¿O `app.propyte.com`? ¿O subdominio interno tipo `crm.internal.propyte.com`?
> - **Q4.** Login del equipo comercial: ¿email+password (Better Auth default), magic link, o Google OAuth con cuentas Propyte Workspace?
> - **Q5.** ¿Champions ven el CRM también o solo el equipo interno? Si sí — diferente role + permisos limitados (su pipeline solamente).
>
> **Decisiones de scope:**
>
> - **Q6.** ¿F1 incluye solo Leads/Contacts/Opportunities (CRM core) o ya empieza con Developments/Units? Recomendación: F1 = core + read-only de Developments/Units. CRUD vertical en F2.
> - **Q7.** ¿El sync Zoho durante F2 es bidireccional o solo Zoho → NextCRM? Bidireccional = más complejo pero permite al equipo trabajar en ambos. One-way = más simple, fuerza al equipo a usar NextCRM antes.
> - **Q8.** ¿Cuándo se decide F3? Criterio sugerido: 4 semanas en F2 sin issues críticos + Luis + 2 comerciales firmando aprobación.
>
> **Decisiones de stack:**
>
> - **Q9.** ¿Activar features AI (Claude enrichment, vector search, E2B sandboxes) en F1 o esperar a F2? Costo Anthropic + complejidad operacional.
> - **Q10.** ¿Inngest cloud (free hasta 50K events/mes) o self-hosted en Hostinger? Cloud = más simple, self-hosted = más control.
> - **Q11.** ¿UploadThing (managed) o MinIO self-hosted en Hostinger para file storage?

## 10. Plan de tareas (preliminar)

### Bloque 0 — Pre-código

- [ ] **Z0.1** Luis responde Q1-Q5.
- [ ] **Z0.2** Fork `pdovhomilja/nextcrm-app` → `Propyte-Team/propyte-crm-base` (visibility según Q1).
- [ ] **Z0.3** Verificar acceso del role de Prisma a `real_estate_hub.*` (GRANT USAGE).
- [ ] **Z0.4** Crear branch base `propyte/main` desde upstream `main`. Tag con SHA upstream para tracking.

### Bloque A — Setup local (1 día)

- [ ] **Z1.1** Clone `Propyte-Team/propyte-crm-base` → `C:/Users/ptoral/Projects/Propyte/propyte-crm-base/`.
- [ ] **Z1.2** Copy `.env.example` → `.env.local`. Setear:
  - `DATABASE_URL` apuntando a Supabase `oaijxdpevakashxshhvm` (Session Pooler aws-1, memoria `feedback_supabase_connection.md`).
  - `AUTH_SECRET` generado nuevo.
  - `ANTHROPIC_API_KEY` (Claude Sonnet 4.6).
  - SMTP Hostinger config.
- [ ] **Z1.3** `pnpm install` + `pnpm db:generate` + `pnpm dev`. Verificar que levanta sin errores en `localhost:3000`.
- [ ] **Z1.4** Login con email/password + crear 1 record en cada módulo (Account, Contact, Lead, Opportunity).

### Bloque B — Schema vertical (2-3 días)

- [ ] **Z2.1** Crear `prisma/schema-propyte.prisma` con los 6 modelos vertical (§6.2).
- [ ] **Z2.2** Habilitar `previewFeatures = ["multiSchema"]` en client Prisma.
- [ ] **Z2.3** `pnpm db:pull` → verificar que importa `Propyte_desarrollos`, `Propyte_unidades`, `Propyte_champions`, `Propyte_zoho_id_map`.
- [ ] **Z2.4** Crear migración Prisma para `public.opportunity_vertical` (nueva tabla satellite).
- [ ] **Z2.5** Entregar SQL a Luis para revisar y aplicar (regla DDL prod).
- [ ] **Z2.6** Generar Prisma client + verificar tipos en TS.

### Bloque C — UI vertical básica (1 semana)

- [ ] **Z3.1** Página `/developments` — list view de desarrollos.
- [ ] **Z3.2** Página `/developments/[id]` — detail view + lista de unidades.
- [ ] **Z3.3** Página `/units` — list view con filtros (city, type, status, price range).
- [ ] **Z3.4** Componente `<UnitsMap />` con Leaflet (cherry-pick eevan7a9).
- [ ] **Z3.5** Página `/champions` — list + detail + assign developments.
- [ ] **Z3.6** Extensión UI de Opportunity → drawer "Propyte vertical" con `unitId`, `championId`, `stage`.

### Bloque D — Sync Zoho F1 (1 semana)

- [ ] **Z4.1** Copiar `propyte-crm/src/lib/zoho/` → `src/lib/zoho/`.
- [ ] **Z4.2** Adaptar `client.ts` para usar NextCRM env vars.
- [ ] **Z4.3** Crear `src/lib/zoho/mapping.ts` con `zohoLeadToNextCRMLead()`.
- [ ] **Z4.4** Crear tabla `zoho_lead_sync` (Prisma migration).
- [ ] **Z4.5** Inngest job `import-zoho-leads` — corre cada 15 min, importa nuevos.
- [ ] **Z4.6** Inngest job `backfill-zoho-leads` — manual trigger, importa 200/página hasta 20K.
- [ ] **Z4.7** Test integration: importar 50 leads de prueba, validar mapping.

### Bloque E — Hardening de seguridad (paralelo a B-D)

Aplicar los REQ-S-01..09 del spec `web-forms-zoho-integration.md` v1.4:

- [ ] **ZS.1** Helmet config conservador (HSTS, X-Frame-Options, sin CSP estricto).
- [ ] **ZS.2** Rate limit + global quota en `/api/*` endpoints públicos.
- [ ] **ZS.3** `sanitizeErrorMessage` en logs/errors.
- [ ] **ZS.4** Better Auth con `secure: NODE_ENV === 'production'` + `sameSite: 'strict'` en cookies de session.
- [ ] **ZS.5** Zod estricto en API routes (UUID, regex en UTM/gclid).
- [ ] **ZS.6** Sentry config + DSN env var (no client bundle).
- [ ] **ZS.7** Audit de los 127 MCP tools — disable tools destructivos hasta F3.

### Bloque F — Hosting + deploy (2-3 días)

- [ ] **Z6.1** Configurar `crm-base.propyte.com` en Hostinger (o el hostname acordado).
- [ ] **Z6.2** PM2 ecosystem file con `instances: 'max'` o `1` según RAM.
- [ ] **Z6.3** Nginx reverse proxy + Let's Encrypt SSL.
- [ ] **Z6.4** Crontab para Inngest schedule (si self-hosted) o configurar Inngest Cloud.
- [ ] **Z6.5** Deploy + smoke test.
- [ ] **Z6.6** Documentar deploy + rollback en `docs/DEPLOY.md`.

### Bloque G — F2 integración (3-4 semanas)

- [ ] **Z7.1** Apuntar `/api/leads` del spec Zoho v1.4 a NextCRM como source primario.
- [ ] **Z7.2** Ejecutar backfill histórico (Z4.6). Validar.
- [ ] **Z7.3** Onboarding del equipo (Luis + Felipe + Alejandro).
- [ ] **Z7.4** Showings module operativo.
- [ ] **Z7.5** Document templates con datos reales.
- [ ] **Z7.6** Reports básicos: pipeline value, conversion rate, lead source.
- [ ] **Z7.7** Cierre F2: checklist + go/no-go para F3.

### Bloque H — F3 cutover (4-8 semanas)

- [ ] **Z8.1** Snapshot Zoho completo a Drive.
- [ ] **Z8.2** Anuncio freeze window al equipo (24h).
- [ ] **Z8.3** Cambiar Zoho a read-only.
- [ ] **Z8.4** Migrar `crm.propyte.com` Meta Ads dashboard a leer de NextCRM.
- [ ] **Z8.5** Exponer Public Listing API + migrar plugin WordPress.
- [ ] **Z8.6** Security audit final (Cyber Neo) — risk score ≤ 20.
- [ ] **Z8.7** Documentar mantenimiento ongoing.

## Apéndice A — Inventario completo de features extraídas

(Ya consolidado en §6.3 tabla cherry-pick. Esta sección queda para referencia futura.)

## Apéndice B — Comparación stack: NextCRM vs Twenty vs construir desde cero

| Criterio | NextCRM | Twenty (descartado) | Build desde cero |
|----------|---------|---------------------|-------------------|
| Stack match con Propyte | 10/10 | 3/10 | 10/10 |
| Tiempo a F1 | 1-2 semanas | 6-12 semanas | 8-12 semanas |
| Mantenimiento ongoing | bajo (200 stars, ~mensual) | alto (30K stars, breaking changes) | alto (todo tú) |
| Features CRM core listas | 95% | 95% | 0% |
| Vertical RE listo | 0% (a construir) | 5% (custom objects) | 0% |
| AI integrado | sí (Claude nativo) | sí (custom build) | no |
| MCP integration | sí (127 tools) | no | no |
| License | MIT | AGPL-3 | propia |
| Riesgo seguridad inicial | bajo (audit clean) | alto (4 críticos) | bajo (auditas tú) |
| Riesgo de "moverte de upstream" | bajo (fork pin SHA) | alto (cambios constantes) | nulo |
| **Recomendación** | ✅ SÍ | ❌ NO | ⚠️ Solo si fallan los anteriores |

## Apéndice C — Roadmap de mantenimiento upstream

Estrategia para no quedarse rezagados ni romper en cada bump:

1. **Pinning:** fork apunta a SHA específico (no a `main`). Cambio de SHA = decisión explícita.
2. **Cadencia:** revisar releases upstream **mensualmente**. Bumpear si: (a) hay security advisory, (b) hay feature relevante, (c) ≥3 meses sin bump.
3. **Process de bump:**
   - Branch nueva `bump/nextcrm-v0.13.0`.
   - Merge upstream (`git fetch upstream && git merge upstream/main`).
   - Resolver conflicts en `prisma/schema-propyte.prisma` y `src/lib/zoho/`.
   - CI verde + smoke test manual.
   - Merge a `main` con squash commit `chore(nextcrm): bump to v0.13.0`.
4. **Customización-friendly:** mantener los customizations en archivos **dedicados** (`/src/modules/propyte/**`, `prisma/schema-propyte.prisma`) — no editar archivos upstream salvo strict necesidad. Cuando inevitablemente toque editarlos: docstring con `// PROPYTE: explicación` para que merges futuros sean reconocibles.
5. **Indicators de divergencia excesiva:** si en >30% de los bumps tienes conflicts, reconsiderar si la customización debería contribuirse upstream o si necesitas separación arquitectónica.

## Apéndice D — Notas operativas

- **PM2 multi-worker:** NextCRM no documenta cluster mode oficialmente. Probar con `instances: 1` primero; si load lo pide, evaluar cluster con sticky sessions para Better Auth.
- **Path logs:** unificar a `/home/propyte/logs/propyte-crm-base.log` (consistente con `feedback_propyte_deploy_topology.md`).
- **Backups:** Supabase nativo (diario, 7 días retention free tier). Para retention >7 días: cron `pg_dump` semanal a Drive (reusar service account de `hub.propyte.com`).
- **Monitoring:** Sentry + UptimeRobot (free tier para 1 monitor cada 5 min).
- **CRON_SECRET rotation:** mensual. Documentar en `docs/SECRETS.md`.
