# WhatsApp multicuenta en el inbox (Cloud API + Coexistence) — Diseño

**Fecha:** 2026-06-22
**Proyecto:** Propyte CRM (`propyte-crm`)
**Estado:** Aprobado por Luis (diseño). Listo para plan de implementación.

## 1. Objetivo

Ver y responder en el inbox del CRM los WhatsApp de **dos números de negocio** (Nativa Tulum y
Propyte), cada uno hoy en la **app WhatsApp Business**, sin perder el uso desde el celular. Cada hilo
debe quedar atribuido a su cuenta y las respuestas salir **desde el número correcto**.

## 2. Decisiones (resueltas con Luis)

- **Conexión:** vía **Coexistence** de Meta (la app del cel y la Cloud API conviven en el mismo
  número; Meta espeja los mensajes por webhook al CRM). NO se usa ninguna librería no oficial
  (whatsapp-web.js/Baileys/scraping) — viola ToS y arriesga ban del número.
- **Cuentas:** **2 números distintos**, ambos hoy en la app Business → **2× onboarding Coexistence**.
- **Alcance:** **ver + responder por cuenta** desde el inbox, con el takeover humano que ya existe;
  **bot por cuenta**.

## 3. Estado actual verificado (código)

- **WhatsApp es single-account por env vars.** `src/lib/whatsapp/transport.ts` envía siempre con
  `META_WA_PHONE_NUMBER_ID` + `META_WA_ACCESS_TOKEN`. El webhook
  `src/app/api/webhooks/whatsapp/meta/route.ts` valida con `META_WA_VERIFY_TOKEN` /
  `META_WA_APP_SECRET` globales y **no lee `value.metadata.phone_number_id`** (nunca sabe qué número
  recibió el mensaje).
- **IG/Messenger YA son por-cuenta** vía `LeadConnector` + `readCredentials` (patrón a reusar):
  `src/lib/messaging/dispatcher.ts` busca `prisma.leadConnector.findFirst({ where: { provider, status: "ACTIVE" } })`
  y descifra `pageAccessToken`. WhatsApp se salta ese camino y va directo al transporte env-based.
- **`ConnectorProvider`** (schema.prisma) NO tiene `WHATSAPP`.
- **`Conversation`** tiene `@@unique([contactId, channel])` (schema.prisma:1485) y **no** tiene
  `connectorId`/`accountId`/`phoneNumberId`. → dos números con el mismo contacto colapsan en un hilo.
- **`Message`** tiene `channel`/`direction`/`externalMessageId`/`externalPhone`, sin
  connector/cuenta.
- **Inbox:** `GET /api/conversations/route.ts` lista por `status`/rol/filtros (`mine/bot/human/unread/
  unassigned/q`), **sin filtro por canal ni cuenta**; retorna `channel`. La respuesta sale por
  `POST /api/conversations/[id]/messages` → `sendChannelMessage(conv.channel)` (dispatcher) →
  `sendWhatsAppMessage` → `deliverWhatsApp` → `deliverViaMetaCloud` (env global).
- **Bot:** `src/lib/bot/bot-respond.ts` recibe `channel` (gate `whatsappOptOut`) pero **no** tiene
  contexto de cuenta ni prompt por marca; `SAGE_SYSTEM_PROMPT` es global.

## 4. Arquitectura (reusar `LeadConnector`, no crear modelo nuevo)

- **Cada número = un `LeadConnector`** con `provider: WHATSAPP` (nuevo valor de enum) y `credentials`
  cifradas (AES-256-GCM, igual que IG/Messenger) `{ phoneNumberId, accessToken, verifyToken,
  appSecret, wabaId, brand }`. `config` puede llevar `brand`/`displayName`. Filas: Nativa + Propyte.
- **Inbound:** el webhook lee `change.value.metadata.phone_number_id` → resuelve el `LeadConnector`
  por ese `phoneNumberId` → rutea la conversación a esa cuenta. Un solo webhook URL
  (`/api/webhooks/whatsapp/meta`). Si los 2 números están bajo la **misma app Meta** comparten
  verify token + app secret a nivel app (se distinguen por `phone_number_id`); si quedaran en apps
  distintas, se usa el `verifyToken`/`appSecret` **del connector** como fallback (la verificación GET
  y la firma se resuelven por número).
- **Outbound:** la respuesta usa `phoneNumberId` + `accessToken` **del connector de la conversación**.
  `deliverViaMetaCloud`/`deliverMetaTemplate` se refactorizan para recibir credenciales en vez de
  leer env. El env global queda como **fallback** (connector "default" = número actual) para no
  romper lo existente.
- **Bot por cuenta:** se propaga `connectorId` (o `brand`) a `botRespond` → selección de
  prompt/firma por marca (Nativa vs Propyte). Default: el prompt actual si el connector no define
  override.

## 5. Modelo de datos (migración aditiva → OK de Luis)

- `enum ConnectorProvider += WHATSAPP`.
- `Conversation += connectorId String?` (FK `LeadConnector`) y la unicidad pasa de
  `@@unique([contactId, channel])` a `@@unique([contactId, channel, connectorId])`.
- **Backfill:** los hilos WhatsApp existentes apuntan al connector "default" creado para el número
  actual (a partir de los env vars vigentes). `connectorId` nullable para canales no-WhatsApp
  (WEB/SMS/IG/Messenger conservan su comportamiento; su unicidad efectiva no cambia porque
  `connectorId` será su propio connector o NULL — ver nota de unicidad abajo).
- **Nota de unicidad:** con `connectorId` nullable, Postgres trata NULLs como distintos en índices
  únicos. Para canales sin connector (p. ej. WEB) esto podría permitir duplicados. Mitigación:
  poblar `connectorId` también para IG/Messenger (ya tienen connector) y, para WEB/SMS, usar un
  índice único parcial o un connector "sistema" por canal. **Decisión:** índice único compuesto
  `[contactId, channel, connectorId]` + para filas con `connectorId IS NULL` mantener el
  comportamiento actual vía índice único parcial `@@unique([contactId, channel]) WHERE connectorId IS NULL`
  (se implementa como índice parcial en la migración SQL manual).

## 6. Componentes y archivos (por fase)

### Fase A — Fundación backend
- `prisma/schema.prisma`: `ConnectorProvider += WHATSAPP`; `Conversation += connectorId` + cambio de
  unicidad. Migración manual `prisma/migrations-manual/2026-06-22-whatsapp-multicuenta.sql`
  (enum value + columna + drop/old unique + new unique compuesto + índice parcial + backfill).
- `src/lib/whatsapp/transport.ts`: `deliverViaMetaCloud`/`deliverMetaTemplate` reciben
  `{ phoneNumberId, accessToken }`; resolución de credenciales por connector con fallback a env.
- `src/lib/messaging/dispatcher.ts`: para `WHATSAPP`, buscar el `LeadConnector` de la conversación
  (por `connectorId`) y pasar credenciales al transporte.
- `src/app/api/webhooks/whatsapp/meta/route.ts`: leer `metadata.phone_number_id`, resolver connector,
  verify/firma por número (con fallback global), propagar `connectorId`.
- `src/lib/messaging/types.ts` (`IncomingMessage += connectorId?`), `src/lib/messaging/core.ts`
  (`conversation.upsert` con clave compuesta `contactId_channel_connectorId` + set `connectorId`),
  y los demás `upsert`/`ensureConversation` (`bot-respond.ts`, `whatsapp.ts`).
- `src/lib/connectors/*` (registry + test-connection): alta/validación de connector WhatsApp.

### Fase B — Inbox UX + admin
- `GET /api/conversations/route.ts`: filtro opcional por `connectorId`/cuenta; incluir nombre/marca
  del connector en el payload.
- Inbox (`src/app/(dashboard)/inbox`): etiqueta/badge de cuenta por hilo ("Nativa"/"Propyte") +
  filtro por cuenta.
- `/conexiones`: panel WhatsApp con wizard de alta (phoneNumberId/token/wabaId/verify/appSecret/brand,
  cifrados) + "Probar conexión" (llamada de prueba a Graph API), igual que el panel Meta.

### Fase C — Bot por cuenta
- `src/lib/bot/bot-respond.ts` (+ `core.ts`): propagar `connectorId`/`brand`; selección de
  prompt/firma por marca; default = prompt actual.

## 7. Flujo de datos (E2E)

1. Lead escribe al número de Nativa → Meta envía webhook con `metadata.phone_number_id = <Nativa>`.
2. El webhook resuelve el `LeadConnector` de Nativa, valida firma (app-level o por connector),
   crea/rutea `Conversation(contactId, WHATSAPP, connectorId=Nativa)` + `Message INBOUND`.
3. El bot (si activo para esa cuenta) responde con la marca Nativa; o un asesor hace takeover.
4. La respuesta sale por `deliverViaMetaCloud` con `phoneNumberId`/token **de Nativa**.
5. En el inbox el hilo muestra badge "Nativa"; un lead que también escriba a Propyte tiene un hilo
   separado con badge "Propyte".

## 8. Manejo de errores
- Webhook con `phone_number_id` sin connector → log + 200 (no romper la entrega de Meta), sin crear
  hilo huérfano (o crear con connector "default" y marcar para revisión — decisión: log + descartar
  con aviso, no inventar cuenta).
- Outbound sin credenciales del connector → fallback a env (número default) solo si el connector es
  el default; si no, error visible en el envío (no mandar desde el número equivocado).
- Firma inválida → 401 (comportamiento actual).

## 9. Pruebas
- **Unit:** ruteo inbound por `phone_number_id` → connector correcto; `upsert` con clave compuesta
  crea hilos separados por cuenta para el mismo contacto; outbound elige credenciales del connector;
  fallback a env cuando es default; verify/firma por connector.
- **Integración:** `POST /conversations/[id]/messages` responde desde el número correcto.
- **Playwright (Windows, patrón standalone+subprocess+JSON):** inbox muestra 2 cuentas con badges;
  filtro por cuenta; alta de connector en `/conexiones` + "Probar conexión".
- **Verificación real:** un mensaje real a cada número crea hilos separados (NO con valores dummy de
  herramientas de prueba de Meta).

## 10. Prerrequisitos de Luis (lado Meta, no código)
- **Coexistence onboarding por número** (Embedded Signup) bajo la app Meta: de ahí salen
  `phoneNumberId` + token de cada número, que se cargan en su `LeadConnector` desde `/conexiones`.
- Suscribir cada número/WABA al webhook del producto WhatsApp (como el pendiente Nativa+Market).

## 11. Fuera de alcance (v1)
- Importar el historial ~6 meses que Coexistence sincroniza (v1 arranca limpio desde la conexión).
- Plantillas/HSM por cuenta más allá de lo que ya existe (se hereda el soporte de templates actual,
  ahora con credenciales por cuenta).
- SMS/otros canales multicuenta (solo WhatsApp en este spec).

## 12. Proceso de entrega
- subagent-driven (implementer Sonnet + spec-review + code-quality por task), TDD, build verde.
- Autoría git Propyte; rama `feat/whatsapp-multicuenta`; merge ff a main (deploy Hostinger).
- La migración (Fase A) se aplica a la BD compartida **solo con OK explícito de Luis**.

## 13. Fases (resumen)
1. **Fase A — Fundación backend:** connector WHATSAPP por-cuenta + `Conversation.connectorId` +
   migración + ruteo inbound por `phone_number_id` + outbound por-cuenta. (Los 2 números funcionan
   E2E a nivel datos.)
2. **Fase B — Inbox UX + admin:** badge/filtro por cuenta + panel WhatsApp en `/conexiones`.
3. **Fase C — Bot por cuenta:** prompt/marca por connector.

Cada fase = su propio plan de implementación.
