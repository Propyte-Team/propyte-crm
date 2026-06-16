# Shortlist enviable — "Propuesta express" (v1 núcleo)

> Spec derivado de `specs/SPECKIT-PROPYTE-CRM-CONSOLIDADO.md` §5.11.4.
> Fecha: 2026-06-16 · Alcance v1: armar → enviar link → trackear. Entrada desde Contacto y Deal.

## 1. Problema

Desde Zoho no hay forma de enviar al cliente un listado curado de unidades del inventario
como propuesta. El asesor lo arma a mano fuera del sistema. Objetivo UX:
*"me envió 10 opciones en 1 minuto"*.

## 2. Alcance

**v1 (este spec):**
- El asesor agrega unidades del Hub (read-only) a un Contacto o Deal → colección curada.
- Genera microsite público `/p/[token]` (sin auth, mobile-first, branding Propyte).
- Tracking de aperturas/vistas con timestamp.

**Fuera de v1 (iteraciones siguientes, ya acordadas como follow-ups):**
- PDF descargable (se hará reusando print del navegador, sin dependencia nueva).
- Promover una unidad de la shortlist → `Quote` formal (§4.3).
- Texto de presentación con guardarraíles de marca §6.0.
- Pre-poblado por matching invertido §5.8.

## 3. Principios respetados

- **P1 / SOT único:** el CRM **no** crea inventario local. La Shortlist solo guarda
  referencias `hubUnitId` + un snapshot congelado de los datos del Hub. (Mismo patrón que
  `Quote.unitSnapshot`.)
- **§5.12.8 Optimistic UI:** agregar/quitar/reordenar unidades se refleja al instante y
  revierte si la API falla.
- Sin dependencias nuevas. Reusa: patrón landing `/q/[id]`, `src/lib/hub/client.ts`,
  dnd-kit, el selector de unidades del form de Deal, tokens B/N (`globals.css`).

## 4. Modelo de datos (additivo — esquema `propyte_crm`)

```prisma
enum ShortlistStatus { DRAFT  SENT  OPENED }   // @@schema("propyte_crm")

model Shortlist {
  id          String          @id @default(uuid())
  token       String          @unique            // identificador público, /p/[token]
  contactId   String                             // a quién se le envía (requerido)
  contact     Contact         @relation(fields: [contactId], references: [id])
  dealId      String?                            // si se armó desde un Deal
  deal        Deal?           @relation(fields: [dealId], references: [id])
  createdById String
  createdBy   User            @relation("ShortlistsCreated", fields: [createdById], references: [id])
  title       String          @default("Propuesta de unidades")
  status      ShortlistStatus @default(DRAFT)
  sentAt      DateTime?
  openedAt    DateTime?                          // primera apertura (conveniencia)
  expiresAt   DateTime?
  items       ShortlistItem[]
  views       ShortlistView[]
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  deletedAt   DateTime?

  @@index([contactId])
  @@index([dealId])
  @@map("shortlists")
  @@schema("propyte_crm")
}

model ShortlistItem {
  id          String    @id @default(uuid())
  shortlistId String
  shortlist   Shortlist @relation(fields: [shortlistId], references: [id], onDelete: Cascade)
  hubUnitId   String                             // referencia al Hub (no FK; otro esquema)
  snapshot    Json      @default("{}")           // datos del Hub congelados al agregar
  note        String?   @db.Text                 // nota del asesor para esa unidad
  sortOrder   Int       @default(0)
  createdAt   DateTime  @default(now())

  @@index([shortlistId])
  @@map("shortlist_items")
  @@schema("propyte_crm")
}

model ShortlistView {
  id          String    @id @default(uuid())
  shortlistId String
  shortlist   Shortlist @relation(fields: [shortlistId], references: [id], onDelete: Cascade)
  viewedAt    DateTime  @default(now())
  userAgent   String?

  @@index([shortlistId])
  @@map("shortlist_views")
  @@schema("propyte_crm")
}
```

- Relaciones inversas a agregar: `Contact.shortlists`, `Deal.shortlists`,
  `User.shortlistsCreated` (relación `"ShortlistsCreated"`).
- `token`: 16 bytes aleatorios (`crypto.randomBytes`) en base64url. Generado en
  `createShortlist`, nunca en el cliente.
- `snapshot`: forma de `HubUnit` (`src/lib/hub/types.ts`): titulo, numero, tipo, tipologia,
  recamaras, banos, m2Construccion, m2Total, precioMxn, precioUsd, moneda, status,
  developmentId.

**Migración:** `prisma/migrations-manual/2026-06-16-shortlist.sql` — additivo + idempotente
(`CREATE TABLE IF NOT EXISTS`, `CREATE TYPE ... / DO $$` para el enum, índices). FKs lógicas a
`contacts`/`deals`/`users` dentro de `propyte_crm`. **NO se aplica sin OK explícito de Luis**
("aplica la migración shortlist") → MCP Supabase + `prisma generate`. Cero cambios a tablas
existentes → riesgo nulo.

## 5. Capa servidor — `src/server/shortlists.ts`

Funciones puras y testeables (estilo `src/server/quotes.ts`):

| Función | Hace |
|---|---|
| `createShortlist({contactId, dealId?, createdById})` | genera `token`, status DRAFT, devuelve registro |
| `addItem({shortlistId, hubUnitId, note?})` | `getHubUnit(hubUnitId)` → congela snapshot, `sortOrder = max+1` |
| `removeItem(itemId)` | borra item |
| `reorderItems(shortlistId, orderedIds[])` | reasigna `sortOrder` |
| `updateItemNote(itemId, note)` | edita nota |
| `sendShortlist(id)` | status SENT + `sentAt`; devuelve URL pública |
| `getShortlistsFor({contactId?, dealId?})` | lista para el panel del asesor |
| `getShortlistByToken(token)` | lectura pública (incluye items ordenados) |
| `recordView(shortlistId, userAgent?)` | inserta `ShortlistView`; setea `openedAt`/OPENED 1ª vez |
| `softDeleteShortlist(id)` | `deletedAt` |

- `addItem` valida que la unidad exista en el Hub antes de congelar; si `getHubUnit`
  devuelve null → error 404 controlado (no se agrega item fantasma).
- Validación de input con zod (patrón del repo).

## 6. API REST

| Ruta | Método | Auth |
|---|---|---|
| `/api/shortlists` | POST (crear), GET `?contactId=&dealId=` | sesión + RBAC (igual que `/api/quotes`) |
| `/api/shortlists/[id]` | PATCH (title / send), DELETE (soft) | sesión |
| `/api/shortlists/[id]/items` | POST (agregar unidad) | sesión |
| `/api/shortlists/[id]/items/[itemId]` | PATCH (nota), DELETE | sesión |

- `params` **síncrono** en rutas dinámicas (convención de este repo — `deals/[id]`,
  `activities/[id]`).
- Errores: catch → 400/404/409 con mensaje claro (patrón BUG-04 en `/api/contacts`).

## 7. Página pública — `/p/[token]/page.tsx`

- Server component, `export const dynamic = "force-dynamic"`. **Fuera del matcher del
  middleware** (verificar `middleware.ts` — mismo trato que `/q` y `/api/webhooks`).
- `getShortlistByToken(token)`; si no existe o `deletedAt` → `notFound()`.
- Al render: `recordView()` (inserta vista + marca `openedAt`/OPENED la 1ª vez), envuelto en
  `.catch(() => null)` para no romper la página si la escritura falla.
- Layout clon de `/q/[id]` (inline styles, branding Propyte, B/N): header "Propuesta",
  "Para: {contacto}", lista de unidades (título · tipo · recámaras · baños · m² · precio
  formateado por moneda) con la nota del asesor, CTA WhatsApp al asesor, footer disclaimer
  "Documento informativo sin valor contractual. Precios y disponibilidad sujetos a cambio".

## 8. UI dentro del CRM — `ShortlistPanel`

Componente compartido B/N (lenguaje de `ActivityLog`), montado en `contact-detail.tsx`
(con `contactId`) y `deal-detail-client.tsx` (con `contactId` + `dealId`):

- **Lista** de propuestas: estado (Borrador / Enviada / Abierta), `N vistas`, última apertura.
- **"Nueva propuesta"** → modo armado: buscador de unidades del Hub (reusa el selector del
  form de Deal), agregar/quitar/reordenar (dnd-kit), nota por unidad. **Optimistic UI.**
- **"Generar y copiar link"** → `sendShortlist` → copia URL `/p/[token]` + botón compartir
  WhatsApp (`wa.me/?text=...`).
- `onChanged={() => router.refresh()}` tras mutaciones (patrón `ActivityLog`).

## 9. Pruebas

- `src/server/shortlists.test.ts` (vitest): token único/no-vacío; `addItem` congela snapshot
  desde un `getHubUnit` mockeado y null → no agrega; `sendShortlist` marca SENT+sentAt;
  `recordView` acumula filas y setea `openedAt` solo la 1ª vez.
- Build limpio + suite verde (hoy 85/85) antes de proponer aplicar migración.
- Smoke en local tras aplicar migración: crear shortlist en un contacto de prueba, agregar
  2 unidades, generar link, abrir `/p/[token]` en incógnito, ver que sube el contador.

## 10. Riesgos / notas

- **BD compartida con prod.** La migración es aditiva (riesgo nulo a datos existentes) pero
  se aplica con OK explícito. Los datos de prueba (shortlists) viven en tablas nuevas, no
  tocan automatizaciones/agentes; abrir `/p/[token]` no dispara workflows.
- `hubUnitId` sin FK (el Hub vive en `real_estate_hub`, otro esquema) — consistente con cómo
  `Deal`/`Quote` referencian unidades hoy.
- Snapshot puede quedar viejo si el Hub cambia precio; mitigado por disclaimer en la página
  pública. Refrescar snapshot = follow-up si se pide.
