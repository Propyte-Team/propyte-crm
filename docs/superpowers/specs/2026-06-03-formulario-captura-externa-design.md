# Formulario externo de captura de desarrollos (Inventario → Catálogo web)

**Fecha:** 2026-06-03
**Estado:** Diseño aprobado (pendiente revisión final del spec)
**Autor:** Luis Flores + Claude

## Resumen

Permitir que cualquier asesor/broker llene la ficha completa de un desarrollo inmobiliario
mediante un **formulario externo accesible por link público (sin login)**. Lo que envían cae en
una **cola de revisión** dentro del Hub; al aprobarse, se crea/actualiza el desarrollo en el
**catálogo web** (`real_estate_hub.Propyte_desarrollos` + `Propyte_unidades`) en estado borrador.
El catálogo web es lo que alimenta propyte.com.

Es el mismo trabajo que hoy se hace a mano (caso Gobernador 28), delegado a los asesores con un
paso de aprobación de por medio.

## Decisiones tomadas (brainstorming)

| Decisión | Elección |
|---|---|
| Destino de los datos | **Catálogo web** (`real_estate_hub`), no el CRM Prisma |
| Acceso del asesor | **Link público con token**, sin cuenta del Hub |
| Qué pasa al enviar | **Cola de revisión**; al aprobar se escribe el catálogo (borrador) |
| Alcance del formulario | **Desarrollo + tipologías + imágenes** |
| Placement de la subpestaña | Dentro de **"Desarrollos"** (`/developments`), tab "Captura" |
| Idiomas v1 | **Solo español**; inglés se genera después (campos `_en` = null) |

## No-objetivos (v1)

- No publica nada automáticamente: la publicación sigue siendo manual.
- No genera contenido en inglés (se hará en una fase posterior con el robot `05-ai-content`).
- No edita el CRM Prisma (`propyte_crm.developments`).
- Sin captcha (el token + caducidad + honeypot son la barrera de v1).

## Contexto del código existente (a reutilizar)

- **Cliente Supabase service_role**: `src/lib/supabase.ts` → `getSupabaseServiceClient()`
  (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`), con `.schema("real_estate_hub")`.
- **Cola de aprobaciones existente** (patrón a espejar): `src/app/(dashboard)/zoho-approvals/`
  + `src/app/api/zoho/approvals/route.ts` (GET lista, PATCH estado) y `.../edit/route.ts`
  (edición de campos con **whitelist**). Es la referencia visual y de escritura al catálogo.
- **Subida de imágenes**: `src/app/api/zoho/approvals/upload-image/route.ts`
  — `sharp` → WebP, máx 10MB, mime whitelist, path `{entityType}/{entityId}/{uuid}.webp`,
  bucket `property-images`. Reutilizamos su lógica para el endpoint de cuarentena.
- **Layout de tabs**: `src/app/(dashboard)/meta-ads/layout.tsx` (Link + underline activo).
- **Form base**: `src/components/developments/development-form.tsx` (shadcn).
- **Middleware**: `src/middleware.ts` — `config.matcher` lista rutas protegidas **explícitas**;
  lo que no está listado queda público (así funcionan `/api/webhooks/**`).
- **Prisma**: `previewFeatures = ["multiSchema"]`, `schemas = ["propyte_crm"]`; convención
  `@id @default(uuid())`, `createdAt/@updatedAt`, soft-delete `deletedAt`, `@@map`, `@@schema`.

> **Nota de implementación:** el endpoint de aprobación debe verificar los nombres exactos de
> columnas/tablas y si la cola actual hace dual-write a un schema `public`, leyendo
> `api/zoho/approvals/edit/route.ts` antes de escribir. El catálogo autoritativo es
> `real_estate_hub.Propyte_desarrollos` / `Propyte_unidades` (confirmado vía MCP en este proyecto).

## Arquitectura y flujo

```
Asesor (sin login)              Hub (DIRECTOR/GERENTE)            Catálogo web (Supabase)
─────────────────               ──────────────────────           ───────────────────────
/captura/[token]  ──submit──▶  IntakeSubmission (PENDING)
  + sube fotos    ──upload──▶  bucket "intake-quarantine"
                                      │
                              /developments › tab "Captura"
                               (bandeja de revisión)
                                      │ Aprobar
                                      ▼
                              mapea payload + mueve fotos ──▶ Propyte_desarrollos (borrador)
                                                            + Propyte_unidades (por tipología)
                                                            + bucket property-images
```

Las tablas nuevas viven en `propyte_crm` (Prisma). El catálogo no se toca hasta aprobar.

## Modelo de datos (Prisma, schema `propyte_crm`)

### IntakeLink
| Campo | Tipo | Notas |
|---|---|---|
| id | String @id @default(uuid()) | |
| token | String @unique | nanoid (~16 chars), va en la URL |
| label | String | etiqueta legible, ej. "Gobernador 28 – Grupo 28" |
| targetDevId | String? | UUID de `Propyte_desarrollos` si es para **actualizar**; null = **nuevo** |
| expiresAt | DateTime? | null = sin caducidad |
| createdBy | String | userId del Hub que generó el link |
| revokedAt | DateTime? | revocación manual |
| createdAt / updatedAt | DateTime | convención casa |

### IntakeSubmission
| Campo | Tipo | Notas |
|---|---|---|
| id | String @id @default(uuid()) | |
| linkId | String → IntakeLink | |
| payload | Json | todos los campos del formulario (ver abajo) |
| imageUrls | String[] | rutas en cuarentena (`intake-quarantine/{token}/...`) |
| status | enum IntakeStatus | PENDING / APPROVED / REJECTED |
| reviewNotes | String? | nota al rechazar/aprobar |
| resultDevId | String? | UUID del dev creado/actualizado al aprobar (idempotencia) |
| reviewedBy | String? | userId que revisó |
| createdAt / updatedAt | DateTime | |

`enum IntakeStatus { PENDING APPROVED REJECTED @@schema("propyte_crm") }`

### Forma del `payload` (JSON, solo ES)
```
{
  generales: { nombre, desarrollador, tipo, etapa, avancePct, fechaEntrega,
               unidadesTotales, unidadesDisponibles },
  ubicacion: { estado, municipio, ciudad, colonia, calle, numeroExt,
               playaDistanciaValor, playaDistanciaUnidad, linkMaps, lat, lng },
  amenidades: { flags: { alberca_comunitaria, gym, coworking, rooftop, elevador,
               area_ninos, cancha, ... }, adicionales: [string] },
  descripciones: { descripcionEs, descripcionCortaEs, conceptoDiseno },
  tipologias: [ { etiqueta, recamaras, banosCompletos, mediosBanos, m2,
               precioDesde, moneda, estado } ],
  multimedia: { tourVirtual, brochureUrl },
  faq: [ { pregunta, respuesta } ]
}
```

## Componentes

### 1. Formulario público — `src/app/captura/[token]/page.tsx` (+ client)
- Ruta **fuera** del `matcher` del middleware → pública.
- Server-side valida el token (existe, no revocado, no expirado). Si inválido, render de
  "Link inválido o expirado".
- Secciones en acordeón (una por bloque), autosave en `localStorage` por token:
  1. Generales 2. Ubicación 3. Amenidades (checkboxes → `amenidad_*`)
  4. Descripciones (ES) 5. Tipologías (lista repetible "+ agregar")
  6. Multimedia + fotos 7. FAQ (repetible).
- UI: shadcn (Input/Select/Label/Card/Button) + `react-hook-form`. Validación mínima:
  nombre y al menos 1 tipología requeridos.
- Si el `IntakeLink.targetDevId` no es null, precarga (solo lectura informativa) el nombre del
  desarrollo a actualizar.

### 2. Endpoints públicos token-gated
- `POST /api/captura/[token]/submit` → valida token + payload (zod), crea `IntakeSubmission`
  PENDING con `imageUrls` ya subidas. Tope de envíos por link (config) + honeypot.
- `POST /api/captura/[token]/upload` → valida token; reutiliza lógica de `upload-image` (sharp→WebP,
  10MB, mime whitelist) a bucket **`intake-quarantine`**, path `{token}/{uuid}.webp`. Límite N
  imágenes por submission y rate-limit por token. Devuelve la ruta.

### 3. Subpestaña "Captura" — dentro de `/developments`
- Convertir `src/app/(dashboard)/developments/` a layout con tabs (patrón `meta-ads/layout.tsx`):
  - **"Desarrollos"** → `/developments` (grid actual, todos los roles).
  - **"Captura"** → `/developments/captura` (solo DIRECTOR/GERENTE; guard en layout + en la page).
- La subpestaña tiene dos vistas (sub-tabs internos o secciones):
  1. **Links**: "Generar link" (modal: nuevo vs actualizar existente, etiqueta, caducidad) →
     muestra/copía la URL `…/captura/{token}`. Tabla de links activos con # de envíos y revocar.
  2. **Bandeja**: tarjetas de `IntakeSubmission` PENDING (espejo visual de `zoho-approvals-client.tsx`)
     con preview del payload + miniaturas. Acciones: **Editar**, **Aprobar**, **Rechazar** (con nota).

### 4. Endpoints de revisión (protegidos, DIRECTOR/GERENTE)
- `GET /api/captura/submissions?status=PENDING` → lista (Prisma).
- `POST /api/captura/links` → genera `IntakeLink`. `PATCH /api/captura/links/[id]` → revocar.
- `PATCH /api/captura/submissions/[id]` → editar payload / rechazar (con nota).
- `POST /api/captura/submissions/[id]/approve` →
  1. Mapea `payload` → upsert en `real_estate_hub.Propyte_desarrollos`
     (`ext_publicado=false`, `web_status='draft'`, `last_source='intake-form'`) vía
     `getSupabaseServiceClient().schema('real_estate_hub')`, respetando el **whitelist** de campos.
     Si `targetDevId` no es null → update con **merge "rellenar huecos"** (no pisar con vacíos);
     si es null → insert nuevo.
  2. Por cada tipología → upsert en `Propyte_unidades` (estado capitalizado canónico, `es_preventa`,
     slug derivado por trigger desde `titulo_unidad`).
  3. Mueve imágenes de `intake-quarantine` → `property-images` y setea `fotos_desarrollo` /
     `foto_portada` / `fotos_unidad`.
  4. `IntakeSubmission.status=APPROVED`, guarda `resultDevId`. **Idempotente**: si ya hay
     `resultDevId`, re-aprobar actualiza ese mismo registro.

## Seguridad

- Públicas: `/captura/*`, `/api/captura/[token]/*` (gated por token válido/no-expirado/no-revocado).
- Protegidas (sesión + rol DIRECTOR/GERENTE): `/developments/captura`, `/api/captura/submissions/*`,
  `/api/captura/links*`. Agregar estos prefijos protegidos al `matcher`; **no** agregar los públicos.
- Subida pública restringida: token requerido, mime whitelist, 10MB, tope de N imágenes, rate-limit.
- Bucket `intake-quarantine` separado del de producción `property-images`.

## Casos borde

- Token expirado / revocado → 410 en API, página de error en la ruta.
- Envío sin tipologías o sin nombre → 400 (validación zod).
- Imágenes huérfanas en cuarentena (submissions rechazadas/abandonadas) → cron de limpieza > 30 días.
- Doble aprobación → idempotente vía `resultDevId`.
- Update de dev existente con datos → merge "rellenar huecos" (lo de Supabase es autoritativo;
  no sobrescribir campos no vacíos con valores vacíos del formulario).
- Estados de unidad → mapear a enum canónico capitalizado
  (`Disponible/Preventa/Reservada/Vendida/...`).

## Pruebas

- Token: válido / expirado / revocado → comportamiento correcto.
- `submit` crea `IntakeSubmission` PENDING con payload e `imageUrls`.
- `upload` respeta mime/tamaño/tope y guarda en cuarentena.
- `approve`: crea dev + unidades en borrador, mueve fotos, marca APPROVED + `resultDevId`;
  re-approve no duplica.
- `approve` con `targetDevId`: hace merge sin pisar campos llenos.
- `reject`: no toca el catálogo; permite nota.
- Guard de rol: ASESOR no entra a `/developments/captura` ni a los endpoints de revisión.

## Fases sugeridas

1. **Datos + plomería**: modelos Prisma (`IntakeLink`, `IntakeSubmission`, enum) + migración;
   cliente y helpers de token. Bucket `intake-quarantine`.
2. **Subpestaña Links**: layout de tabs en `/developments`, generación/listado/revocación de links.
3. **Formulario público**: ruta `/captura/[token]`, secciones, autosave, validación, `submit`.
4. **Upload público**: endpoint de imágenes a cuarentena con límites.
5. **Bandeja + aprobación**: lista, editar/rechazar, y el `approve` con el mapeo al catálogo + fotos.
6. **Pulido**: cron de limpieza de cuarentena, rate-limit, textos de error, QA con un link real.
