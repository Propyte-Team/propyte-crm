# Inbox social: enviar y recibir media (Frente 2 de 4)

**Fecha:** 2026-07-13 · **Aprobado por:** Luis (chat) · Alcance elegido: imágenes, GIF, stickers, documentos/PDF y audio — enviar Y recibir, en WhatsApp Cloud, Messenger e IG DM.

## Estado previo (mapa verificado)

- `Message.mediaUrl` existe pero nada más (sin tipo/nombre/mime). WhatsApp Cloud **descarta** el media ID (`extractBody` solo produce "[Imagen]"); IG/Messenger guardan la URL de CDN de Meta **que expira** y solo el primer attachment; ninguna capa de envío (composer → dispatcher → graph/transport) acepta media; el composer no tiene adjuntar; no existe infra de upload en el CRM.

## Infra (APLICADA 2026-07-13, autorización nombrada de Luis)

- `prisma/migrations-manual/2026-07-13-inbox-media.sql`: columnas additivas `messages.mediaType/mediaFilename/mediaMimeType` (TEXT) + bucket **privado** `chat-media` (100MB cap, sin policies — acceso solo service role + signed URLs).

## Diseño

### Datos y helpers
- `mediaType`: `image | gif | audio | video | document | sticker` (String en BD, zod en app).
- `src/lib/messaging/media.ts` (puro): matriz outbound canal×tipo — WA: image/document/audio/sticker (GIF no; Meta no lo soporta como tal); Messenger: image/gif/audio/video/document; IG: image/gif/audio/video (**sin documentos — límite de la API de Meta**). Límites de tamaño por canal/tipo (WA: img 5MB, audio/video 16MB, doc 100MB, sticker 500KB; MSG/IG: 25MB). Mapeos a shapes de Graph/WA + placeholders de body ("[Imagen]", "[Documento: x.pdf]"...).
- `src/lib/storage/chat-media.ts`: upload de buffer al bucket (`{yyyy-mm}/{uuid}.{ext}`), `createSignedUploadUrl` (subida directa navegador→Supabase, esquiva el trunque multipart >1-2MB de Hostinger), `signChatMediaUrls` batch (24h) para lectura, `mirrorExternalMedia` (descarga URL efímera de Meta → bucket; timeout 8s, cap 25MB, null si falla).

### Recibir
- **WA Cloud** (`webhooks/whatsapp/meta`): para image/audio/video/document/sticker resuelve el media ID (`GET /{media-id}` + descarga Bearer con `META_WA_ACCESS_TOKEN`) → bucket → pasa path+tipo+mime+filename a `handleInboundWhatsApp`. Si falla → comportamiento actual (solo placeholder). Multicuenta WA (token por conector) = follow-up; prod hoy es single-número por env.
- **IG/Messenger** (adapters): leen `attachments[].type` y emiten **un `IncomingMessage` por attachment** (`externalMessageId` = `mid` y `mid#i` para i>0; body = texto del mensaje en el primero, placeholder en el resto). sticker_id→sticker; url `.gif`→gif; file→document; share/fallback→texto con URL. En `core.ts`: si `mediaUrl` es URL externa → `mirrorExternalMedia` → path del bucket; si falla, se guarda la URL efímera (renderiza mientras viva).
- `core.ts` persiste `mediaType/mediaFilename/mediaMimeType` en `Message`.

### Enviar
- Composer: clip → valida tipo/tamaño según canal → `POST /api/inbox/upload-url` (sesión; devuelve signed upload URL) → browser `PUT` directo a Supabase → envía mensaje con `{media: {path, type, filename, mimeType}}`.
- `sendSchema` del POST de mensajes: `body` opcional cuando hay media (notas internas siguen texto-only). Valida tipo permitido por canal server-side.
- Dispatcher `sendChannelMessage(..., opts.media)`: firma el path (1h) para que Meta lo descargue.
  - WA (`transport.deliverViaMetaCloud`): `type image/document/audio/sticker` con `link` (+`caption` = body en image/document; audio/sticker no llevan caption → si hay body, texto aparte).
  - Messenger/IG (`graph.sendGraphAttachment`): `message.attachment {type: image|audio|video|file, payload:{url}}` (gif/sticker→image). Si hay body + media → 2 llamadas (texto y attachment), 1 solo `Message` persistido con el mid del attachment.
  - Twilio driver: passthrough `mediaUrl: [signedUrl]`.
- Stickers salientes: `.webp` en hilo WA se manda como sticker; en MSG/IG como imagen. `.gif` bloqueado en WA (no soportado).

### Leer/renderizar
- `GET /api/conversations/[id]`: los `mediaUrl` que son paths del bucket se convierten a signed URLs (24h) server-side; URLs externas pasan tal cual.
- UI hilo: image/gif/sticker → `<img>` clickeable (sticker chico); audio → `<audio controls>`; video → `<video controls>`; document → link con ícono + filename. Composer muestra chip de preview del adjunto pendiente con X.

## Decisiones
- Bucket **privado** + signed URLs (chats pueden traer datos sensibles); nada público.
- Subida directa navegador→Supabase por el gotcha Hostinger multipart (>1-2MB truncado) — subir vía la API del CRM fallaría en prod.
- Espejado de todo entrante al bucket porque las URLs de CDN de Meta expiran.
- v1 audio = adjuntar archivo; grabadora de notas de voz (MediaRecorder) = follow-up.
- v1 envío de video fuera de alcance (recepción sí se renderiza); múltiples attachments entrantes SÍ se conservan (1 mensaje c/u).

## Verificación
TDD por capa (media.ts, chat-media.ts, adapters, WA resolver, core, transport/graph/dispatcher, route) + gates `vitest`/`tsc --noEmit`/`next build` + smoke en vivo tras deploy.
