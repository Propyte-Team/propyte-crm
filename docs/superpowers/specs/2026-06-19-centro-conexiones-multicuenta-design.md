# Centro de Conexiones Multicuenta — Diseño (v1)

**Fecha:** 2026-06-19
**Proyecto:** Propyte CRM (`propyte-crm`)
**Estado:** Aprobado el diseño por Luis · pendiente revisión del spec → plan de implementación

## 1. Problema

Hoy no existe un panel para que un admin conecte rápidamente las múltiples cuentas de redes
sociales/ads del negocio y jale (pull) los leads hacia el CRM. La única forma actual es la sección
"Conectores de Leads" dentro de **Admin → Integraciones** (`connectors-section.tsx`): un diálogo que
pide pegar credenciales a mano, sin guía, sin prueba previa, sin agrupar por plataforma y sin una
vista clara de multicuenta.

Luis maneja varias cuentas por red: **3 Facebook, 3 Instagram, 2 TikTok, 2 YouTube, 2 Google Ads,
2 LinkedIn, 2 Pinterest**. Necesita un **Centro de Conexiones** con botones de conexión rápida,
multicuenta, que en v1 **jale leads** de cada cuenta hacia el CRM.

## 2. Alcance

### En v1
- **PULL de leads** únicamente (la captura de leads es la prioridad del negocio).
- **Modo de conexión asistido**: el admin pega el token/credencial de cada cuenta con una guía
  paso a paso (wizard). No OAuth de un clic en v1.
- **Multicuenta** por plataforma, en una página dedicada `/conexiones`.
- Pull operativo para: **Meta (Facebook + Instagram), TikTok, Google Ads, LinkedIn**.
- **YouTube y Pinterest**: visibles en el panel pero marcados **"push-only — v2"** (no tienen pull
  de leads útil; YouTube canaliza por Google Ads, Pinterest es limitado). No se permite conectarlas
  para pull en v1; se muestran para que el panel represente todo el ecosistema sin engañar.

### Fuera de v1 (documentado como evolución)
- **Push de Pixel/Conversiones (CAPI)** — ya existe base (`lib/capi/adapters.ts` con adapters
  Meta/TikTok, modelo `ConversionEvent`). Se conecta a estos mismos conectores en **v2** vía
  `direction = OUTBOUND`.
- **OAuth real de un clic** ("Conectar con Facebook" → login → vuelve conectado). Objetivo explícito
  de evolución. El modelo de datos de v1 debe quedar **listo para soportarlo** sin migración
  disruptiva (ver §6). Requiere App de Desarrollador con permisos aprobados por cada plataforma
  (dependencia externa de semanas), por eso no entra en v1.
- Pull real de YouTube/Pinterest.

## 3. Principios y reutilización

El CRM **ya tiene** la mayor parte de la tubería. v1 NO reinventa nada de esto:

| Pieza existente | Rol | Archivo |
|---|---|---|
| `LeadConnector` (modelo) | 1 fila = 1 cuenta. Genérico, ya multicuenta | `prisma/schema.prisma` |
| `ConnectorLeadLog` | Idempotencia `@@unique([connectorId, externalLeadId])` + auditoría | `prisma/schema.prisma` |
| `readCredentials` / `writeCredentials` | Cifrado AES-256-GCM de credenciales | `lib/intake/connectors.ts` |
| `mapExternalFields` | `fieldMap` externo → `IncomingLead` | `lib/intake/connectors.ts` |
| `processIncomingLead` | Punto único de entrada idempotente de un lead | `lib/intake/connectors.ts` |
| `captureLead` | Crea/dedup contacto → ruteo (`autoRouteLead`) → SLA | `lib/intake/capture-lead.ts` |
| CRUD conectores | GET/POST + PATCH/DELETE por id, con redacción de credenciales y `auditLog` | `app/api/admin/connectors/route.ts`, `[id]/route.ts` |
| Webhook Meta Lead Ads | Pull en tiempo real (objeto page, campo leadgen) | `app/api/connectors/meta/webhook/route.ts` |
| Cron TikTok Lead Gen | Pull cada 5 min | `app/api/cron/connectors/tiktok/route.ts` |
| Schemas de credenciales | Validación zod por proveedor | `lib/validations/rebuild-f1.ts` |

**Lección heredada aplicada:** la migración de schema es **aditiva** y se aplica a la Supabase
compartida (`oaijxdpevakashxshhvm`) solo con autorización explícita de Luis ("aplica la migración
…"); nunca DDL en runtime. Ver `feedback_schema_sin_migracion_rompe_cliente` y
`feedback_autorizacion_explicita_infra`.

## 4. Arquitectura v1

### 4.1 Capas

```
/conexiones (página, layout A: secciones por plataforma)
   └─ ConnectButton/Wizard (drawer guiado por pasos, por proveedor)
        └─ POST /api/admin/connectors/test   (NUEVO — valida credencial contra la API real)
        └─ POST /api/admin/connectors        (existente — crea en PAUSED)
        └─ PATCH /api/admin/connectors/:id   (existente — activa/pausa)

Pull entrante (sin cambios de tubería):
   Meta webhook ───┐
   TikTok cron  ───┤
   Google Ads pull ┼─→ processIncomingLead → captureLead → autoRoute/SLA
   LinkedIn pull  ─┘     (idempotencia por connector_lead_logs)
```

### 4.2 Registro de proveedores (config-driven)

Punto central nuevo: `lib/connectors/registry.ts`. Cada proveedor declara, en un solo lugar:

```ts
interface ProviderDef {
  id: ConnectorProvider;        // META, INSTAGRAM, TIKTOK, GOOGLE_ADS, LINKEDIN, YOUTUBE, PINTEREST...
  label: string;                // "Facebook · Lead Ads"
  group: "meta" | "tiktok" | "google" | "linkedin" | "pinterest";
  pull: "webhook" | "cron" | "none";   // none ⇒ push-only v2 (deshabilitado en v1)
  credFields: { key: string; label: string; help?: string; secret?: boolean }[];
  wizardSteps: { title: string; body: string; link?: string }[];  // guía variante A
  testKind: "meta" | "tiktok" | "googleAds" | "linkedin";          // cómo se prueba
}
```

Esto extiende el patrón actual `CRED_FIELDS` de `connectors-section.tsx`, ahora compartido entre
UI (campos + pasos) y servidor (validación + prueba). El panel y el wizard se renderizan desde el
registro: agregar una plataforma futura = agregar una entrada.

### 4.3 Flujo "Conectar cuenta" (wizard, variante A)

Drawer lateral, pasos numerados (ej. Meta): 1) abre tu app en developers.facebook.com (enlace
directo) → 2) genera un Page Access Token con permiso `leads_retrieval` → 3) pega token + Page ID →
4) **Probar conexión** → si pasa, **Guardar y activar**.

- "Probar conexión" llama `POST /api/admin/connectors/test` con `{provider, credentials}`. El handler
  hace una llamada de solo-lectura a la API del proveedor (ej. Meta: `GET /{pageId}?fields=name`
  con el token; Google Ads: un `customer` query mínimo; LinkedIn: `GET /me`/lead forms). Devuelve
  `{ok, accountName?, detail?}` sin persistir nada.
- Solo si la prueba pasa se permite "Guardar y activar" → POST (crea PAUSED, cifra credenciales) +
  PATCH a ACTIVE. Las credenciales **nunca** se releen al cliente (redacción ya implementada).

### 4.4 Adapters de pull nuevos

- **Google Ads (Lead Form):** los leads de Lead Form se obtienen por webhook de Google
  (Lead Form Ad → webhook con `google_key`) o por pull de la API. Decisión de implementación
  (a resolver en el plan): preferir **webhook de Lead Form** (`POST /api/connectors/google/webhook`)
  por simplicidad y tiempo real; el cron queda como fallback. Reusa `processIncomingLead`.
- **LinkedIn (Lead Gen Forms):** pull por cron (`/api/cron/connectors/linkedin`, p.ej. cada 15 min)
  contra la API de Lead Gen Forms del ad account. Reusa `processIncomingLead`.
- Meta/IG y TikTok: **sin cambios** de tubería; el panel solo crea/gestiona sus conectores.

### 4.5 Página `/conexiones` (layout A)

- Server component que carga conectores vía el GET existente, agrupados por `group` del registro.
- Por plataforma: encabezado con contador `conectadas/total-cuentas-config` + filas de cuenta
  (nombre, estado `●`, último lead, # leads, errores) + acciones (pausar/activar/eliminar, reusan
  PATCH/DELETE) + fila "＋ Conectar cuenta" que abre el wizard.
- Estética B/N existente: Space Grotesk, hairlines, numerales JetBrains Mono tabulares, micro-labels
  uppercase, sin iconitos de colores. Coherente con el "panel de instrumento" del CRM
  (ver `feedback_ui_craft_no_admin_template`).
- Entradas de navegación: **sidebar** (grupo Admin/Configuración) + tarjeta en `/configuracion`.
- La sección `ConnectorsSection` dentro de `integrations-tab.tsx` se **retira** (o se reemplaza por
  un enlace a `/conexiones`) para no duplicar superficie.

## 5. Datos / Migración

**Migración aditiva** (`prisma/migrations-manual/2026-06-19-conexiones-multicuenta.sql`):

```sql
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE IF NOT EXISTS 'GOOGLE_ADS';
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE IF NOT EXISTS 'YOUTUBE';
ALTER TYPE "propyte_crm"."ConnectorProvider" ADD VALUE IF NOT EXISTS 'PINTEREST';
-- LINKEDIN ya existe en el enum.
```

- `ALTER TYPE … ADD VALUE` debe correrse **fuera de transacción** y **antes** de usar los valores
  (lección de migraciones de enum previas en este repo).
- No se agregan columnas en v1. El `config` JSON de `LeadConnector` absorbe parámetros por cuenta
  (ej. `formId` de filtro, `advertiserId`, `customerId`).
- **Preparación para OAuth (v2, sin migración disruptiva):** cuando llegue OAuth, los tokens
  (access/refresh/expiry) caben en el mismo `credentials` cifrado (JSON) o en un modelo hermano
  `ConnectorOAuthToken` espejo de `GoogleOAuthToken`. El spec deja constancia de que el diseño no
  obliga a rehacer `LeadConnector`.

## 6. Seguridad

- Credenciales cifradas AES-256-GCM (`writeCredentials`), nunca devueltas al cliente (redacción ya
  implementada en el GET).
- Endpoints admin-only: roles `ADMIN/DIRECTOR/GERENTE/MARKETING` (igual que el CRUD actual).
- `auditLog` en alta/baja (ya implementado en POST; replicar en el endpoint de test no es necesario
  porque no persiste).
- "Probar conexión" no guarda nada y no loguea el token; en errores, loguear solo `e.message`
  (lección Gmail: nunca loguear el objeto de error completo, puede llevar secretos).

## 7. Pruebas

- **Unit:** `mapExternalFields` ya testeado; agregar tests del registro (cada `ProviderDef` válido) y
  de los parsers de payload de los adapters nuevos (Google Ads, LinkedIn) con payloads de ejemplo.
- **Unit:** `processIncomingLead` ya cubre idempotencia; agregar caso para los nuevos `source`
  derivados (GOOGLE_ADS → `GOOGLE_ADS`, LINKEDIN → `LINKEDIN`).
- **Integración (mock):** endpoint `/test` por proveedor con cliente HTTP mockeado (ok / token
  inválido / cuenta inexistente).
- **E2E (Playwright, lo valida Luis con credenciales vivas):** abrir `/conexiones`, conectar una
  cuenta Meta por el wizard, "Probar conexión" verde, activar, ver la cuenta en su sección.
- **Smoke de pull real** lo prueba Luis (requiere tokens/permisos vivos por plataforma).

## 8. Fases sugeridas (para el plan)

1. **Fundación:** migración aditiva del enum + `lib/connectors/registry.ts` (Meta/IG, TikTok,
   Google Ads, LinkedIn, + YouTube/Pinterest como `pull:"none"`).
2. **Endpoint `/test`** + validación por proveedor (Meta y TikTok primero, reusando sus clientes).
3. **Página `/conexiones` (layout A)** + wizard (variante A) + sidebar/`configuracion` + retiro de
   `ConnectorsSection`. Piloto E2E con **Meta**.
4. **Adapters de pull nuevos:** Google Ads (webhook Lead Form) + LinkedIn (cron Lead Gen Forms).
5. **Cierre:** YouTube/Pinterest como push-only deshabilitado; docs de activación (permisos por
   plataforma, URLs de webhook, env/crons).

## 9. Dependencias externas (las resuelve Luis)

- Por cada plataforma: app/credenciales con permiso de lectura de leads
  (`leads_retrieval` Meta; Lead Gen TikTok; Lead Form Google Ads; Lead Gen Forms LinkedIn).
- URLs de webhook a registrar (Meta ya; Google Lead Form nuevo).
- Cron nuevo en Hostinger para LinkedIn (header `x-cron-secret`, NO Authorization Bearer — el CDN
  lo stripea).

## 10. Preguntas abiertas (para el plan)

- Google Ads: ¿webhook de Lead Form (recomendado) o pull por API? Resolver en el plan según el setup
  real de las campañas de Luis.
- LinkedIn: cadencia del cron (15 min propuesto).
- ¿La página `/conexiones` reemplaza por completo a `integrations-tab.tsx` o conviven (Integraciones
  conserva otras integraciones no-conector, ej. Zoho/Google Workspace)? — probable: conviven, y
  Conexiones se lleva solo los `LeadConnector`.
