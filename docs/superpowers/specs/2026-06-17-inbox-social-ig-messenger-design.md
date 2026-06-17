# Inbox social: Instagram DM + Facebook Messenger (v1)

> Spec de diseño · 2026-06-17 · rama `feat/crm-inbox-social`
> Gap del speckit consolidado §5.10.1 ("Inbox unificado de redes sociales"). Materializa P4 (timeline unificada) para los canales sociales que hoy son punto ciego.

## 1. Objetivo y alcance

Sumar **Instagram DM** y **Facebook Messenger** a la timeline unificada de conversaciones del CRM (hoy: WhatsApp/SMS/email/llamada), con el **mismo intake** que el resto de canales: dedup → ruteo → SLA, conversación en el inbox con bot IA + takeover humano.

**Decisiones base (aprobadas por Luis, 2026-06-17):**
- **Fuente:** webhook **Meta directo** (Instagram Messaging + Messenger Platform vía Graph API), consistente con WhatsApp Cloud API y Meta Lead Ads que ya viven en el CRM. **No** se usa el "pipeline del Hub" del texto del speckit: ese pipeline no existe (el Hub solo da inventario/ads) y añadiría latencia y un segundo repo.
- **DM de desconocido:** crear `Contact` nuevo + rutear como lead + arrancar SLA (uniforme con WhatsApp). Máxima captura.
- **Bot:** el agente IA (Sage L2) **también** responde DMs (conversación en estado BOT, con takeover humano), reusando los guardarraíles §6.0.
- **Canales:** Instagram **y** Messenger juntos en v1 (comparten casi todo el código).
- **Estructura:** core de intake agnóstico de canal + adapters por canal.

### Fuera de v1 (YAGNI)
- Comentarios públicos de IG/FB (solo DMs directos en v1).
- Stories replies / reactions / quick replies más allá de texto + media básico.
- Opt-out por keyword en social (la ventana de 24h de Meta ya limita el spam saliente).
- Difusión / plantillas sociales (proyecto aparte, como envío masivo de correo).

## 2. Arquitectura

Webhook Meta **nuevo** para IG + Messenger; el webhook de WhatsApp queda **intacto**. Se extrae un **core de intake agnóstico** y **adapters por canal**:

```
Meta Graph webhook (instagram + page)
        │
   POST /api/webhooks/meta-dm        ← verify (GET) + firma x-hub-signature-256 (POST)
        │
   adapter.parse(payload) ──► IncomingMessage { channel, senderId, text, mediaUrl, mid, profileName? }
        │
   core: handleInboundMessage(IncomingMessage)      ← AGNÓSTICO de canal
        │  match Contact (instagramId/messengerPsid) → captureLead si nuevo
        │  upsert Conversation · create Message (dedup mid) · Activity · SLA · bot
        ▼
   (BOT) botRespond → dispatcher.send(channel, …)   |  (HUMAN) inbox → dispatcher.send(channel, …)
```

- **`src/lib/messaging/core.ts`** — `handleInboundMessage(msg: IncomingMessage)`: toda la lógica común (match/dedup/conversación/mensaje/actividad/SLA/bot). Es la pieza que hoy está embebida en `handleInboundWhatsApp` (`src/lib/twilio/whatsapp.ts`).
- **`src/lib/messaging/adapters/{whatsapp,instagram,messenger}.ts`** — cada adapter expone `parseWebhook(payload): IncomingMessage[]` y `send(opts): {externalMessageId, status}`.
- **`src/lib/messaging/dispatcher.ts`** — `sendChannelMessage(channel, contactId, body, userId)` → adapter correspondiente.
- WhatsApp se **refactoriza** para que su webhook llame al core compartido; cubierto con tests de no-regresión (los actuales + casos nuevos).

## 3. Modelo de datos (migración aditiva)

Migración manual `prisma/migrations-manual/2026-06-17-inbox-social.sql` (additiva + idempotente; `ALTER TYPE ... ADD VALUE IF NOT EXISTS` en statements separados por el patrón conocido de enums en transacción).

| Cambio | Detalle |
|---|---|
| `enum ConversationChannel` | += `INSTAGRAM`, `MESSENGER` |
| `enum MessageChannel` | += `INSTAGRAM`, `MESSENGER` |
| `enum ActivityType` | += `INSTAGRAM_IN`, `INSTAGRAM_OUT`, `MESSENGER_IN`, `MESSENGER_OUT` (consistente con `WHATSAPP_IN/OUT`) |
| `enum LeadSource` | += `MESSENGER` (ya existe `INSTAGRAM`) |
| `enum ConnectorProvider` | += `INSTAGRAM`, `MESSENGER` (distintos de `META`, que es Lead Ads) |
| `Contact` | += `instagramId String?`, `messengerPsid String?` — **índice único parcial** `WHERE col IS NOT NULL` (patrón `gmailMessageId`). Ids de sistema → columnas, no `custom` JSON (no aplica la regla JSONB+registro de §P2). |
| `Message` | += `externalMessageId String?` — único parcial. Dedup del `mid` de Meta (replay-safe). WhatsApp sigue usando `twilioSid`. |

`Conversation` ya tiene `@@unique([contactId, channel])`: un contacto puede tener hilos separados de WhatsApp / IG / Messenger. Sin cambios estructurales ahí.

## 4. Flujo inbound

1. **`GET /api/webhooks/meta-dm`** → responde `hub.challenge` si `hub.verify_token` coincide con el del conector activo.
2. **`POST /api/webhooks/meta-dm`** → valida `x-hub-signature-256` contra el `appSecret` del conector. ACK rápido (200) y procesa.
3. El **adapter** del canal normaliza el payload de Meta a `IncomingMessage[]`:
   - Messenger: `entry[].messaging[]` (sender.id = PSID).
   - Instagram: `entry[].messaging[]` o `entry[].changes[]` field `messages` (sender.id = IGSID).
4. **`handleInboundMessage`** (core):
   1. Match `Contact` por `instagramId`/`messengerPsid` según canal.
   2. Si no hay match → `captureLead({ source: INSTAGRAM | MESSENGER, name, socialId })`:
      - Nombre vía Graph `GET /{psid|igsid}?fields=name,username` (**best-effort**; si falla → "Instagram User" / "Messenger User").
      - Guarda `instagramId`/`messengerPsid` en el `Contact` nuevo.
      - `captureLead` corre dedup (phone/email aquí vacíos) → ruteo `autoRouteLead` → `createSlaTimer(FIRST_TOUCH)`.
   3. Upsert `Conversation({ contactId, channel })` (status `BOT` por defecto).
   4. Create `Message({ channel, direction: INBOUND, externalMessageId: mid, body, mediaUrl, sender: CONTACT })`. **Dedup por `externalMessageId` único** → reentregas de Meta no duplican.
   5. Create `Activity({ activityType: INSTAGRAM_IN | MESSENGER_IN })`.
   6. `meetSlaTimers(contactId)`.
   7. Si `status == HUMAN` → notifica a `controlledBy`/`assignedTo`. Si `status == BOT && botEnabled` → `botRespond()` (Sage L2), respetando la ventana de 24h.

## 5. Flujo outbound

- `sendChannelMessage(channel, contactId, body, userId)` (dispatcher) → adapter:
  - `WHATSAPP` → `sendWhatsAppMessage` (existente).
  - `INSTAGRAM` → Graph `POST /{ig-id}/messages`, `recipient: { id: igsid }`.
  - `MESSENGER` → Graph `POST /me/messages` (page token), `recipient: { id: psid }`.
- **Ventana de 24h:** dentro → mensaje estándar. Fuera → Meta rechaza (salvo tags `HUMAN_AGENT`/human-agent, fuera de v1) → el `Message` se marca `FAILED` con motivo, igual que el patrón WhatsApp (Meta acepta wamid y descarta async). El **bot solo responde dentro de ventana**.
- `POST /api/conversations/[id]/messages` deja de invocar `sendWhatsAppMessage` directo y llama al **dispatcher** según `conversation.channel`. (Refactor puntual; mantiene el comportamiento de upgrade BOT→HUMAN al responder un humano.)
- Cada envío crea su `Message(OUTBOUND)` + `Activity(_OUT)` y guarda el `externalMessageId` devuelto por Graph.

## 6. Bot IA

Sin cambios en el motor: `botRespond` y los guardarraíles §6.0 son agnósticos del canal. La única diferencia es que el envío de la respuesta sale por el adapter del canal (dispatcher). Takeover humano → `status = HUMAN`, `controlledById = userId` (lógica existente del inbox).

## 7. Inbox UI

Cambios mínimos en `src/components/inbox/inbox-view.tsx`:
- Mostrar **ícono/etiqueta de canal** por conversación (WhatsApp / Instagram / Messenger).
- **Filtro por canal** (opcional, junto a los filtros all/mine/bot/human/unread).
- El envío ya pasa por el dispatcher server-side → el composer funciona igual para cualquier canal.

## 8. Admin / credenciales

Nuevo conector en **Admin → Integraciones** reusando el CRUD de `LeadConnector`:
- `provider`: `INSTAGRAM` / `MESSENGER`.
- `credentials` (cifrado AES-GCM): `pageAccessToken`, `appSecret`.
- `config` (JSON): `pageId`, `igBusinessId`, `verifyToken`.

## 9. Compliance

- Respetar la **ventana de 24h** de Meta (no enviar fuera, salvo tags fuera de v1).
- Respetar `Contact.doNotContact` (no enviar) y el flujo de takeover.
- Aviso de privacidad / términos de Meta: responsabilidad de la cuenta (config una vez), no del código.

## 10. Testing

- **Unit:**
  - Adapters de parseo: payloads de muestra de Meta (IG `changes`/`messaging`, Messenger `messaging`) → `IncomingMessage[]` correcto.
  - Dispatcher de envío: Graph API mockeado, valida endpoint/recipient por canal.
  - Core `handleInboundMessage`: (a) match por `instagramId`/`messengerPsid`; (b) DM de desconocido crea lead nuevo + ruteo + SLA; (c) reentrega con mismo `mid` no duplica `Message`.
  - No-regresión WhatsApp: el webhook actual sigue creando Conversation+Message+Activity tras el refactor al core.
- **Verificación manual:** webhook con payloads de muestra; envío real y recepción los prueba Luis (requiere permisos Meta vivos). Smoke en `/inbox` con una conversación social.

## 11. Pendientes de Luis (Meta / infra)

1. App Meta con permisos `instagram_manage_messages` + `pages_messaging` (App Review si aplica).
2. Suscribir el webhook field `messages` para los objetos `instagram` y `page`; configurar callback URL `https://crm.propyte.com/api/webhooks/meta-dm` + verify token.
3. `pageAccessToken` (long-lived), `appSecret`, `verifyToken`, `pageId`, `igBusinessId`.
4. Vincular la cuenta de **Instagram profesional** a la **página de Facebook**.
5. Dar de alta el conector en Admin → Integraciones con esos valores.

## 12. Riesgos / notas

- **Ruido/spam:** "crear lead + rutear" ante cualquier DM puede generar leads basura desde IG. Mitigación futura (no v1): heurística de calificación previa o estado "social sin SLA". Se aceptó el riesgo para v1 por uniformidad.
- **Refactor de WhatsApp:** extraer el core toca código en producción que funciona. Mitigación: tests de no-regresión antes de tocar; el webhook de WhatsApp mantiene su endpoint y firma.
- **Identidad cruzada:** un mismo humano puede ser un Contact por IG y otro por WhatsApp (sin tel/email que los una). La **vista de duplicados** (§5.10.2, ya implementada) permite fusionarlos manualmente; el matching automático cross-canal queda fuera de v1.
- **Bot en canal público:** un error del bot es visible. Guardarraíles §6.0 + takeover humano mitigan; monitorear las primeras semanas.
