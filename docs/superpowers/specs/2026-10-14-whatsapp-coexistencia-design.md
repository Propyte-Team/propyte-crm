# WhatsApp en coexistencia — números de marca y de asesor conectados por Embedded Signup

**Fecha:** 2026-10-14
**Estado:** implementado en dos PR apilados, pendiente de revisión.
  - PR 1 `feat/wa-coexistencia` (base `main`): números de **marca**.
  - PR 2 `feat/wa-coexistencia-asesores` (base PR 1): números de **asesor** y filtro de privacidad.
**Motivo inmediato:** conectar el WhatsApp Business de Yaxnáh (y de cada asesor) al CRM sin que dejen de
usar la app en el teléfono. Hoy el único camino es «WhatsApp · Cloud API» con campos manuales, que
exige un número que NO esté en la app.

Propyte CRM actúa como su propio **Tech Provider** de Meta. Con **Embedded Signup v4** y la función de
incorporación de usuarios de la app WhatsApp Business («Coexistence»), un número de la app queda conectado
a Cloud API y sigue funcionando en el teléfono; los dos lados quedan sincronizados.

---

## 1. Objetivo y criterios de éxito

1. Desde Conexiones, un ADMIN/DIRECTOR/GERENTE/MARKETING pulsa «Conectar WhatsApp (oficial)», elige la
   marca, completa el flujo de Meta y el número queda como cuenta WHATSAPP de esa marca, activa, con el
   token cifrado. Repetir el flujo con el mismo número **actualiza** la cuenta; no la duplica.
2. Lo que el negocio escribe desde el teléfono (`smb_message_echoes`) aparece en la bandeja como saliente
   de asesor en la conversación correcta.
3. El historial (hasta 6 meses, `history`) se importa **solo** para contactos que ya existen en el CRM.
4. Si el negocio se desconecta desde la app o cambia de teléfono (`account_update`), la cuenta se marca
   desconectada / reconectada y se avisa a los ADMIN.
5. (PR 2) Cada usuario conecta **su** WhatsApp Business desde «Mi Perfil». En su número solo entran al CRM
   los chats de prospectos; de un remitente desconocido no se guarda ni texto ni media, solo un registro
   mínimo de «posible prospecto» que ve únicamente ese asesor.
6. (PR 2) El bot nunca contesta en un número de asesor.
7. Sin las variables de entorno el botón explica qué falta en vez de fallar.
8. Vitest (archivos tocados y suite completa), `npm run typecheck` y eslint sobre lo cambiado pasan en cada rama.

---

## 2. Decisiones del dueño (2026-10-14) — no se vuelven a preguntar

1. **Números de asesor, privacidad:** solo se guardan chats de prospectos. Un chat se guarda si el otro
   lado ya es contacto vivo del CRM (mismo emparejado que el webhook de hoy: teléfono E.164 / últimos 10
   dígitos y BSUID) o si el asesor lo marca como prospecto. De un remitente desconocido NO se guarda
   cuerpo ni media; solo un registro «posible prospecto» con número o WA id, nombre de perfil, primera y
   última vez visto y cuántos mensajes. Lo ve solo ese asesor, con «Es prospecto» (crea un contacto asignado
   al asesor; desde ahí se guardan sus mensajes) e «Ignorar» (deja de listarse). Los chats personales
   nunca entran al CRM.
2. **El bot NUNCA contesta en números de asesor.** Solo contesta el asesor, desde el teléfono o desde la bandeja.
3. **Historial** (hasta 6 meses por la sincronización de coexistencia): solo de chats con contactos ya
   existentes; lo demás se descarta. Igual para números de marca.
4. **Números de marca** = el WhatsApp de marca de hoy: cuenta con `brandId`, aplican las reglas del
   agente/bot de la marca y la visibilidad por marca; un desconocido que escribe se da de alta como hoy
   (es una línea de negocio). El historial, aun así, solo de contactos existentes (decisión 3).

---

## 3. Lo que dice Meta (verificado en la documentación, 2026-10-14)

| Tema | Lo que hacemos | Fuente |
|---|---|---|
| Embedded Signup v4; v2 se depreca el 2026-10-15 | v4: configuración de Facebook Login for Business con productos seleccionados (eso fija la v4); el `config_id` va en `FB.login`. No se pasa `version` en `extras`. | [Versions](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions), [Version 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4), [blog v4](https://developers.facebook.com/blog/post/2026/05/14/embedded-signup-v4/) |
| Coexistencia en v4 | «continues to be supported through the feature_type parameter»: `extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" }` | [Version 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4), [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users) |
| Lanzamiento | SDK JS (`connect.facebook.net/en_US/sdk.js`), `FB.init({ appId, autoLogAppEvents, xfbml, version })`, `FB.login(cb, { config_id, response_type: "code", override_default_response_type: true, extras })`. Escucha `message` con origen `*.facebook.com`, `type: "WA_EMBEDDED_SIGNUP"`. | [Implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/) |
| Evento de fin | `event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"`, `data.waba_id` (el ejemplo de coexistencia NO trae `phone_number_id`; el genérico sí). `CANCEL` trae `current_step` o `error_message`. | mismas |
| Código | El `code` llega en `response.authResponse.code` y **dura 30 s**: se manda al servidor en cuanto están el código y el WABA. | [Implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/) |
| Canje del código | `GET /oauth/access_token?client_id&client_secret&code`, servidor a servidor → token de negocio. | [Onboarding as a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider) |
| Suscripción | `POST /{waba_id}/subscribed_apps` con el token de negocio. | misma |
| Registro del número | **Se omite**: «skip the phone number registration step, as the number is already registered». | [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users) |
| Estado (opcional) | `GET /{phone_number_id}?fields=is_on_biz_app,platform_type` → `true` y `CLOUD_API`. | misma |
| Sincronización | `POST /{phone_number_id}/smb_app_data` con `sync_type: "smb_app_state_sync"` (contactos) y luego `"history"`. Cada una **una sola vez**; hay **24 h** desde el alta o hay que desconectar y repetir. | misma |
| Webhooks nuevos | `history`, `smb_app_state_sync`, `smb_message_echoes` (además de `messages` y `account_update`). | misma |
| `history` | Fases 0/1/2 (día 0–1, 1–90, 90–180), `chunk_order`, `progress` (100 = terminó). Sin chats de grupo. La media llega aparte (solo 14 días). Si el negocio no comparte: error `2593109`. «Un solo webhook puede traer miles de mensajes»: capturar y procesar asíncrono. | [history webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/history/) |
| `smb_message_echoes` | `value.message_echoes[]` con `from` (negocio), `to` (usuario), `id`, `timestamp`, `type`. | [smb_message_echoes](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes/) |
| `smb_app_state_sync` | `value.state_sync[]` con `type: "contact"`, `contact.{full_name, first_name, phone_number}`, `action: add | remove`. | [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users) |
| `account_update` | `PARTNER_REMOVED` (con `disconnection_info.reason/initiated_by`), `ACCOUNT_OFFBOARDED` (cambio de equipo / reinstalación), `ACCOUNT_RECONNECTED`. `entry.id` = WABA. | [account_update](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update/), [Reconnect offboarded coexistence clients](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/reconnect-offboarded-coexistence-clients) |
| Desconexión | No hay API: el negocio entra a la app → **Configuración → Cuenta → Plataforma para empresas → Desconectar** («Settings > Account > Business Platform > Disconnect Account»). | [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users) |
| Límites | 20 mensajes/s por número en coexistencia. Error `131060` en mensajes no soportados (primer mensaje de un usuario o equipo acompañante no soportado; se resuelve solo). | misma |
| Tech Provider | Verificación del negocio, App Review con `whatsapp_business_messaging` y `whatsapp_business_management` (acceso avanzado), y el negocio conectado debe poner un método de pago en su WABA. | [Become a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers), [Embedded Signup overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview) |

**No verificado / incierto** (también en la sección 10): la forma exacta del JSON de `oauth/access_token`
(la doc solo muestra `<BUSINESS_TOKEN>`; se lee `access_token`, que es la respuesta OAuth estándar de Graph);
si `sessionInfoVersion: "3"` sigue haciendo falta en v4 (la página de coexistencia lo sigue mostrando, se
manda); y si repetir el flujo con un número ya conectado reabre la ventana de sincronización.

---

## 4. Modelo de datos

### PR 1 — `prisma/migrations-manual/2026-10-14-whatsapp-coexistencia.sql`

- Enum `ConnectorScope` (`BRAND`, `ADVISOR`) y columna `lead_connectors.scope` NOT NULL DEFAULT `BRAND`:
  todas las cuentas de hoy quedan como de marca sin rellenar nada.
- Índice único parcial `(config->>'phoneNumberId') WHERE provider='WHATSAPP' AND "deletedAt" IS NULL`:
  dos cuentas vivas con el mismo número es justo lo que la idempotencia quiere impedir, y la base es el
  único sitio donde eso no tiene carrera. Medido el 2026-10-14: 0 cuentas WHATSAPP en producción.
- `propyte_crm.users` **no se toca** (lo comparte el Hub).

El estado de la coexistencia vive en `config.coex` (JSON, sin secretos):

```jsonc
{
  "phoneNumberId": "…", "wabaId": "…", "displayPhone": "+52 …", "verifiedName": "…",
  "onboarding": "coexistence",
  "coex": {
    "connectedAt": "ISO", "accountState": "CONNECTED | OFFBOARDED | DISCONNECTED",
    "accountEventAt": "ISO", "disconnection": { "reason": "…", "initiatedBy": "USER|SYSTEM" },
    "isOnBizApp": true, "platformType": "CLOUD_API",
    "contactsSync": { "state": "REQUESTED | FAILED", "at": "ISO", "requestId": "…", "error": "…" },
    "historySync": { "state": "REQUESTED | IN_PROGRESS | COMPLETE | DECLINED | FAILED", "at": "ISO", "progress": 55, "phase": 1 }
  }
}
```

`config.coex` se escribe con una sola sentencia SQL que mezcla claves (`jsonb_set` + `||`): llegan
webhooks de historial en paralelo con el `account_update`, y un leer-modificar-escribir desde JS perdería
uno de los dos.

### PR 2 — `prisma/migrations-manual/2026-10-14-whatsapp-asesores.sql`

- `lead_connectors."ownerUserId"` (FK a users, `ON DELETE SET NULL`) + índice. La pertenencia vive en la
  cuenta, no en `users`.
- Tabla `whatsapp_pending_prospects`: `connectorId`, `ownerUserId`, `senderKey` (E.164 o BSUID; UNIQUE con
  la cuenta), `phone`, `waUserId`, `profileName`, `contactName` (de la libreta, si llega), `firstSeenAt`,
  `lastSeenAt`, `messageCount`, `status` (`PENDING | PROMOTED | IGNORED`), `contactId`. **Sin columna de
  cuerpo ni de media**: el modelo no tiene dónde guardarlos, que es la forma más barata de garantizar la
  decisión 1.

---

## 5. Alta (los dos PR)

`src/lib/whatsapp/coex/onboard.ts` — un solo orquestador para marca y asesor:

1. Valida entorno (`NEXT_PUBLIC_META_APP_ID`, `META_WA_APP_SECRET`) → 503 si falta.
2. **Canjea el código primero** (vive 30 s).
3. Si no llegó `phone_number_id`, lo busca en `GET /{waba}/phone_numbers` (único, o el único con
   `is_on_biz_app`); si es ambiguo, 409 explicando.
4. Lee el número (`display_phone_number`, `verified_name`, `is_on_biz_app`, `platform_type`).
5. Conflictos: una cuenta viva con ese número y otro alcance (marca ↔ asesor) u otro dueño → 409 sin escribir.
6. Suscribe la app a la WABA. Si falla, la cuenta se guarda en ERROR (para no perder el token) y **no** se
   piden sincronizaciones: sin suscripción los webhooks del historial se perderían y la sincronización solo
   se puede pedir una vez.
7. Crea o actualiza la cuenta (ACTIVA, token cifrado con `writeCredentials`, `scope`, `brandId`/`ownerUserId`).
   Antes de pedir el historial, porque sus webhooks pueden llegar en segundos.
8. Pide contactos y luego historial — solo si no se pidieron ya en esta conexión (repetir el flujo no los
   vuelve a pedir; tras una desconexión sí).
9. Auditoría. La respuesta **nunca** trae el token; los mensajes de Meta se limpian de token, código y secreto.

Rutas: PR 1 `POST /api/admin/connectors/whatsapp-coex` (ADMIN, DIRECTOR, GERENTE, MARKETING; `brandId`
opcional). PR 2 `GET|POST /api/me/whatsapp` (cualquier rol, `ownerUserId` = la sesión).

Las variables `NEXT_PUBLIC_*` se leen **en el servidor en tiempo de ejecución** (acceso dinámico a
`process.env`) y se pasan al cliente como props: Next congela en el build las referencias literales a
`process.env.NEXT_PUBLIC_*`, y en Hostinger se cambian desde hPanel sin recompilar.

---

## 6. Webhook (`/api/webhooks/whatsapp/meta`)

Se despacha por `change.field` (sin `field` = `messages`, como llegan las pruebas y el formato viejo).
Mismo acuse rápido:

| Campo | Antes del 200 | Después del 200 (`runAfterResponse`) |
|---|---|---|
| `messages` | igual que hoy (PR 2: filtro de privacidad en asesores) | bot (nunca en asesores) |
| `smb_message_echoes` | se guarda el eco (son pocos) | — |
| `history` | — | importación (puede traer miles) |
| `smb_app_state_sync` | — | enriquecer nombres |
| `account_update` | estado de la cuenta + avisos | — |

- **Ecos:** sin cuenta ACTIVA del número → no se guarda nada. Se busca el contacto por `to`; sin contacto no
  se guarda (mismo criterio que los ecos de IG/Messenger: nunca se crean contactos desde un eco). Con
  contacto: `handleInboundMessage({ isEcho: true })` → OUTBOUND, `sender: ADVISOR`, deduplicado por wamid
  (en `externalMessageId` y `twilioSid`), toma de control del hilo si estaba en BOT, SLA cumplido. La media
  solo se descarga cuando ya se sabe que hay contacto.
- **Historial:** por hilo, se busca el contacto con el mismo emparejado del webhook. Sin contacto → el hilo
  entero se descarta (no se guarda nada). Con contacto → `ensureConversation` de esa cuenta y `createMany`
  sin duplicados (wamid contra `externalMessageId`/`twilioSid`), con la fecha original, dirección
  (`to` presente o `from` = el número del negocio → saliente de asesor) y estado. No dispara bot, SLA,
  actividades, avisos ni contadores de no leídos: es pasado. `lastMessageAt`/`lastInboundAt` solo avanzan.
  El webhook aparte con la media solo completa mensajes que ya se importaron. `2593109` → historial
  «rechazado por el negocio». `progress` → estado de sincronización.
- **Libreta (`smb_app_state_sync`):** nunca crea contactos. Solo pone el nombre a un contacto existente que
  sigue con el nombre provisional («WhatsApp (por identificar)»). PR 2: también el `contactName` de un
  posible prospecto pendiente.
- **`account_update`:** la cuenta se busca por `config.wabaId` (= `entry.id`). `PARTNER_REMOVED` → ERROR +
  «desconectado desde la app»; `ACCOUNT_OFFBOARDED` → ERROR + «desconectado temporalmente»;
  `ACCOUNT_RECONNECTED` → ACTIVA si la habíamos puesto en ERROR por esto. Aviso a los ADMIN personas (y,
  en PR 2, al dueño del número), solo cuando el estado cambia: una reentrega no repite el aviso. Mientras
  está desconectada, `resolveWhatsAppSender` lanza un error claro en vez de dejar que Meta falle.
- **Guardia de número desconocido:** un número conectado se reconoce por su cuenta, como hoy. PR 2: un
  número de asesor cuya cuenta está pausada, en error o borrada se reconoce igual y **se descarta todo** —
  sin esto, sus chats personales entrarían por el camino del «número sin registrar» y se darían de alta.

---

## 7. Números de asesor (PR 2)

- **Alta** desde «Mi Perfil» → «Conectar mi WhatsApp»: mismo flujo, `scope: ADVISOR`, `ownerUserId` = la sesión.
- **Filtro de privacidad** (`src/lib/whatsapp/coex/asesor.ts`), aplicado a `messages`, ecos e historial:
  - contacto vivo (teléfono/BSUID) → se guarda por el camino normal, con `createContact: false` (si el
    contacto desaparece entre la búsqueda y el guardado, no se crea uno) y sin reparto;
  - desconocido → solo `upsert` del posible prospecto (contadores y fechas). Ni cuerpo, ni media, ni
    descarga de media, ni conversación, ni actividad. Uno ignorado no se vuelve a tocar.
  - ecos e historial de desconocidos → se descartan (no suman al posible prospecto: no los escribió él).
- **Dueño:** el `assignedToId` del contacto no se cambia; si no tiene dueño, se le asigna al asesor.
- **Bot:** `botRespond` sale en falso si la cuenta (o la del hilo) es de asesor — prueba incluida. El
  webhook tampoco lo agenda. Además: las conversaciones de un número de asesor nacen en HUMAN con el asesor
  al mando y el bot apagado; `ensureConversation` no adopta hilos de otra línea para una cuenta de asesor ni
  reutiliza un hilo de asesor para una clave sin cuenta; `findConversationForChannel` (lo que usan
  workflows, agentes y acciones de IA para elegir línea) ignora los hilos de asesor; y
  `sendWhatsAppMessage` con autoría de bot rechaza una cuenta de asesor.
- **Envío desde la bandeja:** sale por el número del asesor (envío por cuenta de siempre). Ventana de 24 h y
  plantillas sin cambios.
- **«Posibles prospectos»** en «Mi Perfil», solo del asesor dueño: «Es prospecto» crea el contacto con
  `captureLead` (sin reparto) y se lo asigna (si ya existía con dueño, no se le quita); sin teléfono (solo
  BSUID) no se puede dar de alta (#830) y se dice. «Ignorar» lo oculta y deja de contarse.
- **Admin:** en Conexiones, lista de números de asesor (dueño, número, estado) con la instrucción para
  desconectar desde la app. Visibilidad de conversaciones: la de hoy más la de marca.

---

## 8. Variables de entorno

| Variable | Qué es | Dónde |
|---|---|---|
| `NEXT_PUBLIC_META_APP_ID` | ID de la app de Meta (público) | hPanel |
| `NEXT_PUBLIC_META_ES_CONFIG_ID` | ID de la configuración de Facebook Login for Business (Embedded Signup v4) | hPanel |
| `META_WA_APP_SECRET` | ya existe: firma del webhook y ahora `client_secret` del canje | hPanel (sin cambio) |

Lista para quien no es desarrollador: `docs/whatsapp-coexistencia-meta-setup.md`.

---

## 9. Pruebas

- Alta: camino feliz, idempotencia (mismo número → update, sin volver a pedir sincronización), roles,
  mapeo de errores (código caducado, red, suscripción, ambigüedad, conflicto de alcance), y que el token,
  el código y el secreto no salgan ni en la respuesta ni en un log.
- Webhook: cada campo nuevo (ecos, historial con y sin contacto, rechazo `2593109`, media aparte, libreta,
  `account_update` en sus tres estados y reentrega), compatibilidad con payloads sin `field`.
- PR 2: filtro (contacto conocido guardado; desconocido → solo pendiente y sin cuerpo; «Es prospecto»;
  «Ignorar»), ecos e historial filtrados igual, bot nunca en asesor, número de asesor inactivo descartado.

---

## 10. Riesgos y pendientes

- **Aplicar las migraciones ANTES de desplegar** cada PR: Prisma lee `scope` (y en PR 2 `ownerUserId`) en
  cada consulta de cuentas.
- El historial se procesa después del 200. Si el proceso se reinicia a mitad, ese trozo se pierde (Meta no
  reintenta un 200). Se eligió así porque procesarlo antes del 200 pasaría los 30 s y Meta reintentaría.
- App Review: mientras la app no tenga acceso avanzado a `whatsapp_business_messaging` y
  `whatsapp_business_management`, el flujo solo funciona para quien tenga rol en la app.
- Tech Provider: los negocios conectados (cada asesor incluido) deben agregar un método de pago a su WABA
  para mensajes de pago (plantillas). Pendiente decidir si Propyte se vuelve Solution Partner o se asocia a uno.
- No verificado en la doc: forma exacta de la respuesta de `oauth/access_token`; si `sessionInfoVersion`
  sigue siendo necesario en v4; si repetir el flujo sobre un número ya conectado permite sincronizar otra vez.
- Un asesor que deja la empresa: su número sigue conectado hasta que lo desconecte desde la app; el admin
  puede pausar o borrar la cuenta en el CRM y, desde PR 2, todo lo que llegue de ese número se descarta.
