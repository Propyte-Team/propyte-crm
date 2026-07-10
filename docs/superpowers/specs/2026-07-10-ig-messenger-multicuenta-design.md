# Multicuenta IG DM + Messenger — recibir y responder por cuenta, sin cruce de tokens

**Fecha:** 2026-07-10
**Rama base:** `feat/whatsapp-multicuenta` (se aterriza como fundación)
**Estado:** Diseño para revisión de Luis

---

## 1. Contexto y problema

El CRM ya tiene inbox social (IG DM + Messenger) desplegado, con modelo **Messenger API for Instagram (Page-based / Facebook Login)**: recepción por webhook `meta-dm` (objetos `instagram` y `page`) y envío por `graph.facebook.com/.../me/messages` con `pageAccessToken`. Confirmado en `origin/main`.

Luis conectó **3 cuentas IG** (Nativa Tulum, Propyte, Propyte Market) y quiere sumar **Messenger** de las mismas páginas. Auditando el código desplegado aparecen 3 fallas que **impiden operar 3 cuentas**:

1. **Envío cruza tokens.** `sendChannelMessage` resuelve el conector con `leadConnector.findFirst({ provider: INSTAGRAM, status: ACTIVE })` → agarra el *primer* conector activo, sin importar a qué cuenta llegó el DM. Con 3 conectores IG activos, una respuesta a un DM de Propyte puede salir con el token de Nativa.
2. **Sin atribución de cuenta en la recepción.** Los parsers (`parseInstagramWebhook` / `parseMessengerWebhook`) descartan `entry[].id` (el ID de la cuenta IG / Página receptora). `IncomingMessage` no lo lleva; nunca se resuelve ni se guarda el conector por cuenta.
3. **Messenger sin conector.** Los 3 conectores sociales son `provider=INSTAGRAM`; no existe ninguno `MESSENGER`.

Además, el `pageAccessToken` vive (correctamente) en `credentials` **cifrado** (AES-GCM), NO en `config`. Cargarlo en `config` (JSONB plano) rompería el envío y expondría el token.

**La recepción SÍ funciona sin `config`**: apenas se termine la suscripción en Meta + env vars `META_DM_*`, los DMs entran al inbox. El problema es **responder con la cuenta correcta**.

---

## 2. Decisiones (sesión con Luis, 2026-07-10)

- **Modelo:** Messenger API for Instagram (Page-based / Facebook Login), `graph.facebook.com` + `pageAccessToken`. **NO** Instagram Login directo ni `graph.instagram.com`.
- **Alcance:** construir el **multicuenta completo ANTES de conectar** (no conectar en modo parcial).
- **Canales:** IG DM **+ Messenger**.
- **Base:** extender la rama `feat/whatsapp-multicuenta`, reusando su infra connector-aware (no duplicar en rama nueva).
- **Almacenamiento por conector:**
  - `config` (texto plano, no secreto): `{ pageId, igBusinessId, brand }` → para rutear.
  - `credentials` (cifrado): `{ pageAccessToken, appSecret, verifyToken }` → para enviar/validar firma.
- **App Meta:** "Propyte CRM" (App ID `1718579335943082`).

---

## 3. Arquitectura

### 3.1 Reuso de la rama `feat/whatsapp-multicuenta`

Ya provee (verificado):
- `src/lib/messaging/conversations.ts` — `ensureConversation({ contactId, channel, connectorId })` + `findConversationForChannel` (connector-aware).
- `src/lib/whatsapp/accounts.ts` — patrón **`resolveConnectorByPhoneNumberId`** (consulta JSONB por `config.phoneNumberId`) + **`getWhatsAppCredentials`** (combina `config` no-secreto + `credentials` descifrado). Este es el patrón exacto a replicar para social.
- Migración `prisma/migrations-manual/2026-06-22-whatsapp-multicuenta.sql` — agrega `ConnectorProvider.WHATSAPP` + columna `conversations.connectorId` + FK + unicidad `(contactId, channel, connectorId)` + índice parcial único `(contactId, channel) WHERE connectorId IS NULL`.

### 3.2 Modelo de datos

- **`LeadConnector.config`** (JSONB): `{ pageId, igBusinessId, brand }` — identificadores NO secretos, consultables por JSONB path.
- **`LeadConnector.credentials`** (cifrado): `{ pageAccessToken, appSecret, verifyToken }`.
- **`conversations.connectorId`** — de la migración 2026-06-22. Cada conversación queda atada a la cuenta receptora.
- **Sin migración nueva:** `MESSENGER` ya está en el enum `ConnectorProvider` (migración inbox-social 2026-06-17); `connectorId` lo agrega la migración 2026-06-22. `config`/`credentials` son JSONB → sin DDL adicional.

### 3.3 Resolución de cuenta — nuevo `src/lib/messaging/social-accounts.ts`

Espejo de `whatsapp/accounts.ts`:
- `resolveConnectorByIgBusinessId(id)` → `findFirst({ provider: "INSTAGRAM", status: "ACTIVE", deletedAt: null, config: { path: ["igBusinessId"], equals: id } })`.
- `resolveConnectorByPageId(id)` → idem con `provider: "MESSENGER"` y `config.pageId`.
- `getSocialPageToken(connector)` → `readCredentials<{ pageAccessToken }>(connector)` con guardas.

> **Nota de investigación (verificar empíricamente en el primer webhook real):** en el objeto `instagram`, `entry[].id` suele ser el **IG Business Account ID** (= `igBusinessId`); en el objeto `page`, es el **Page ID**. Si el valor real difiere (p. ej. page-scoped id), el resolver hace fallback: IG intenta `igBusinessId` y luego `pageId`. Se confirma con el primer inbound logueado (sin secretos).

### 3.4 Recepción (entrante)

1. `parseInstagramWebhook` / `parseMessengerWebhook` capturan `entry.id` → `IncomingMessage.accountId`.
2. `IncomingMessage` += `accountId?: string` (y ya soporta `connectorId?`).
3. `meta-dm/route.ts`: por cada mensaje, resuelve el conector (`resolveConnectorByIgBusinessId` para IG, `resolveConnectorByPageId` para Messenger) y setea `msg.connectorId`.
   - **Si NO resuelve conector:** se **procesa igual** (no se pierde el DM) con `connectorId=null` + `console.warn` con el `accountId` (sin secretos). La conversación queda visible en el inbox; el **envío** exigirá conector (error claro "conector no configurado para esta cuenta").
4. `handleInboundMessage` ya threadea `msg.connectorId` a `ensureConversation` → la conversación nace con `connectorId`.

### 3.5 Envío (saliente) — fin del cruce de tokens

- **`sendChannelMessage` cambia de firma** para recibir el conector objetivo (vía `conversationId` o `connectorId`), NO `findFirst`.
- Resuelve el conector desde **la conversación específica**, carga su `pageAccessToken` de `credentials`, envía. `/me/messages` con ese token resuelve a la página dueña → cuenta correcta.
- **Callers a actualizar (grep EXHAUSTIVO de `sendChannelMessage`** — recordar la lección "el lookup vivía en 6 lugares"):
  - `src/app/api/conversations/[id]/messages/route.ts` — ya tiene `conv`; pasar `conv.connectorId`/`conv.id`.
  - `botRespond` — resolver la conversación con `findConversationForChannel(contactId, channel)` → su `connectorId`.
  - Acciones de workflow `SEND_*` que manden por canal social, si las hay.
- WhatsApp mantiene su propia resolución (`accounts.ts`), ya multicuenta en la rama.

### 3.6 UI admin de conectores (`connectors-section.tsx` + endpoint save)

- Separar **config** vs **credentials**:
  - Nuevos **CONFIG_FIELDS** para INSTAGRAM/MESSENGER: `pageId`, `igBusinessId` (+ `brand` opcional) → escritos a `config`.
  - **CRED_FIELDS** queda: `pageAccessToken`, `appSecret`, `verifyToken` → cifrados en `credentials`.
  - **Migrar** el `pageId` que hoy está en `credentials` → `config` (mismo save, sin recrear).
- El endpoint create/update del conector rutea cada campo a su columna.

### 3.7 Validación / diagnóstico de arranque (requisito #4)

- `checkSocialConnector(connector)` → `{ ok, missing: string[] }` verificando: `config.pageId` (Messenger) / `config.igBusinessId` (IG) + `credentials.pageAccessToken`. **Nunca** loguea valores de secretos.
- `GET /api/admin/connectors/health` (RBAC ADMIN/DIRECTOR/GERENTE) — lista por conector social si los 3 campos están presentes (booleans, sin secretos).
- Log de arranque no-bloqueante vía `instrumentation.ts` que advierte conectores incompletos (nombre + campos faltantes, sin secretos).

### 3.8 Bump de versión Graph (requisito #3)

- `src/lib/messaging/graph.ts`: `GRAPH` `v21.0` → **`v24.0`**.
- `src/lib/connectors/test-connection.ts`: `v21.0` → `v24.0`.
- Bajo riesgo (misma superficie de Send API); incluido en el mismo branch.

---

## 4. Infra / configuración

- **Migración:** aplicar la existente `2026-06-22-whatsapp-multicuenta.sql` en **2 envíos** (ADD VALUE fuera de transacción). Es aditiva y verificada. **Luis autoriza** antes de aplicar (Supabase compartida `oaijxdpevakashxshhvm`). **Sin migración nueva.**
- **Env vars (hPanel, Luis):** `META_DM_VERIFY_TOKEN`, `META_DM_APP_SECRET` (= App Secret de "Propyte CRM", == `META_WA_APP_SECRET`). Reiniciar app (Passenger).
- **Credenciales por conector (Luis, por la UI):** cada conector IG/Messenger con su trío `{ pageId, igBusinessId, pageAccessToken }` emparejado por `pageId` (sin cruzar), + `appSecret`/`verifyToken`.
- **No se exponen tokens** en logs, cliente ni repo (requisito #5). Claude NO puede escribir `credentials` (cifradas con llave de entorno que no lee); las carga Luis por la UI.

---

## 5. Fuera de alcance (YAGNI)

- Instagram Login directo / `graph.instagram.com`.
- Adjuntos multimedia salientes (v1 solo texto, como hoy).
- Handover Protocol formal con ManyChat (solo pausar flujos que dupliquen).
- Migración de datos de las conversaciones existentes (hay 1, de prueba).

---

## 6. Testing

- **Unit (TDD):**
  - `resolveConnectorByIgBusinessId` / `resolveConnectorByPageId` devuelven el conector correcto y `null` si no hay match.
  - Parsers capturan `entry.id` → `accountId`.
  - `sendChannelMessage` usa el conector de **la conversación** (mock: 3 conectores → elige el correcto, NUNCA `findFirst`).
  - `checkSocialConnector` detecta faltantes.
- **Regresión:**
  - 1 solo conector activo → sigue funcionando (comportamiento equivalente a hoy).
  - Ningún test ni log imprime valores de `pageAccessToken`/`appSecret`.
  - WhatsApp multicuenta de la rama sigue verde.
- **E2E (Luis, con cuentas que tengan rol admin/dev/tester en la app hasta pasar App Review):**
  - Por cada cuenta IG (x3) y Messenger: DM entrante → aparece en inbox **atribuido a la marca correcta** → responder desde el inbox → **llega desde esa misma cuenta** (no cruzado).

---

## 7. Checklist Meta (Luis) — recordatorio

- **IG (x3):** webhook `messages` objeto `instagram`; permisos `instagram_manage_messages`/`pages_messaging`/`pages_manage_metadata`; IG profesional ↔ Página FB vinculado; credenciales por conector en la UI (incl. `igBusinessId`).
- **Messenger:** suscribir `messages` al objeto `page` (hoy solo `name`); crear 3 conectores `MESSENGER` en el CRM con sus credenciales.
- **Cierre:** reiniciar la app en hPanel tras cargar env vars/credenciales.

---

## 8. Datos de los 3 conectores (de Luis, emparejar por `pageId`, sin cruzar)

| Marca | pageId | igBusinessId |
|---|---|---|
| Nativa Tulum | 103981554499114 | 17841453458089530 |
| Propyte | 834510929743516 | 17841478714467578 |
| Propyte Market | 939477015926372 | 17841448140150826 |

> Los `pageAccessToken` (System User, permanentes) los carga Luis por la UI; no viven en el repo ni en este documento.
