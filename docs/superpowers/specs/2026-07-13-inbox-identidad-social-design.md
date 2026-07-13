# Inbox social: identidad del remitente + cuenta visible (Messenger / IG DM)

**Fecha:** 2026-07-13 · **Aprobado por:** Luis (chat) · **Frente 1 de 4** (identidad → media → plantillas → agentes)

## Problema

Un DM de Messenger llegó al CRM como contacto **"Messenger (por identificar)"**:

1. `handleInboundMessage` (`src/lib/messaging/core.ts:50-51`) crea el contacto con nombre placeholder; nadie consulta el perfil del remitente en Graph API. El helper `fetchGraphProfileName` de `graph.ts` existe pero tiene **0 callers**.
2. La conversación **sí** quedó ligada a su conector ("Messenger | DM Nativa", verificado en BD), pero el Inbox no muestra la cuenta/marca en la lista ni en el hilo.

## Diseño

### 1. `src/lib/messaging/profile.ts` (nuevo)

- `fetchSocialProfile(channel, senderId, pageToken)` → `{ firstName, lastName, avatarUrl } | null`.
  - MESSENGER (PSID): `GET /v24.0/{psid}?fields=first_name,last_name,profile_pic`.
  - INSTAGRAM (IGSID): `GET /v24.0/{igsid}?fields=name,username,profile_pic` — `name` se parte en primer token / resto; sin apellido usa `(@username)`; solo username → `@username` como firstName.
  - Timeout 4s (AbortController, gotcha Hostinger), try/catch total → `null`. **Nunca lanza.**
- `fetchProfileForMessage(msg)`: si canal es IG/MESSENGER y hay `connectorId` → carga conector, `getSocialPageToken` (descifra credenciales), fetch. Si algo falta → `null`.

### 2. Hook en `core.ts`

Solo cuando hace falta (1 llamada Graph por contacto, no por mensaje):

- **Contacto nuevo:** fetch ANTES de `captureLead` → se crea ya con nombre real (la Activity y el ruteo salen con nombre). Falla → placeholder actual (regresión cero).
- **Contacto existente con `lastName === "(por identificar)"`:** fetch + update de `firstName`/`lastName` vía `withChangeSource({source:"social_profile"})` → el próximo mensaje del lead de Nativa lo auto-repara y queda en la cronología.
- `avatarUrl` se guarda en `Contact.custom.avatarUrl` (merge, sin migración). Nota: las URLs de CDN de Meta expiran; la UI oculta el avatar si no carga.

### 3. Cuenta visible (UI)

- API lista (`/api/conversations`) y detalle (`/api/conversations/[id]`): incluir `connector → { name, brand }` (de `config.brand`, no-secreto) + `contact.avatarUrl` (mapeado server-side desde `custom`).
- `inbox-view.tsx`: badge de marca junto al badge de canal en la lista (ej. "Messenger · Nativa tulum") y en la banda de estado del hilo; avatar circular si existe. WhatsApp single-número (connectorId null) → solo canal, como hoy.

### 4. Backfill

`scripts/backfill-social-profiles.ts`: contactos con `lastName = "(por identificar)"` y `messengerPsid`/`instagramId` → resuelve conector vía su conversación → fetch → update. One-shot manual (requiere env local con acceso a BD + llave de cifrado); si no se corre, el contacto se repara solo al siguiente mensaje.

## Decisiones

- Fetch en core (no en adapters/webhook): evita llamada Graph por cada mensaje y cubre la reparación de contactos existentes.
- No se toca `IncomingMessage` (hay WIP paralelo en `types.ts` del árbol principal — cero conflicto).
- `fetchGraphProfileName` (muerto) se deja intacto por la misma razón; `profile.ts` lo supersede.
- Permisos Meta: mismos que el envío de DMs (`pages_messaging` / `instagram_manage_messages`). Si Meta niega el campo → fallback placeholder (visible en smoke).

## Verificación

TDD (`profile.test.ts` + casos nuevos en `core.test.ts`), gates `vitest` + `tsc --noEmit` + `next build`, smoke E2E con el lead real de Nativa (PSID 37004534595860126).
