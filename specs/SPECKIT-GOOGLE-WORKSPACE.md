# SPECKIT — Integración Google Workspace (Propyte CRM)
### Gmail bidireccional · Google Calendar sync · Google Contacts push

> **Companion #5.** Complementa el consolidado v1.1, el detallado v1.0 y Conectividad/Agentes/CAPI.
> **Base:** stack `propyte-crm` (Next.js 14 + Prisma + Supabase + NextAuth). El equipo de ventas ya opera en Google Workspace.
> **Objetivo:** que cada deal y contacto muestre su timeline completo de emails y reuniones sin salir del CRM — paridad con la experiencia nativa de Zoho CRM + Google.
> **Versión:** 1.0 — 2026-06-12

---

## 0. CONTEXTO Y MOTIVACIÓN

El equipo de ventas de Propyte vive en Gmail y Google Calendar. Hoy, cada email intercambiado con un prospecto y cada reunión agendada ocurre **fuera del CRM**: el asesor tiene que loguear actividades manualmente, lo que produce timelines incompletos, pérdida de contexto al reasignar deals y fricción en el coaching. La integración Google Workspace cierra esta brecha conectando la cuenta Gmail personal del asesor con su identidad en el CRM. El resultado visible: abres un deal y ves en orden cronológico todos los emails, llamadas de WhatsApp y reuniones — igual que Zoho CRM lo hace hoy. La integración es **por asesor** (cada uno conecta su propia cuenta), **server-side** (tokens nunca en el browser), **fire-and-forget** (el sync nunca bloquea el pipeline de ventas) y de **degradación suave** (si no hay cuenta conectada, las funciones GW simplemente no aparecen).

---

## 1. PRINCIPIOS

- **PG1 — Por asesor, no por organización.** Cada `User` conecta su propia cuenta Google desde `/settings`. No hay cuenta de servicio organizacional; los tokens son del asesor, no de Propyte.
- **PG2 — Server-side only.** Todo uso de la API de Google ocurre en Next.js server routes con el paquete `googleapis` npm. Cero SDKs client-side de Google; cero tokens en el browser.
- **PG3 — CRM es SOT (source of truth).** Contactos, deals y actividades viven en el CRM. Google Calendar y Contacts son espejos de salida; los datos maestros no se sobrescriben desde Google salvo en casos explícitos (sync inverso de Calendar).
- **PG4 — Fire-and-forget vía action_queue.** Las operaciones hacia Google (crear evento, crear contacto, log de email) se encolan en la `action_queue` del motor de workflows. Un fallo de Google no bloquea al asesor.
- **PG5 — Scope mínimo.** Solo los permisos necesarios: `gmail.readonly`, `gmail.send`, `calendar`, `contacts.readonly`. Nunca `drive`, nunca `admin`.
- **PG6 — Respetar doNotContact.** Ninguna acción de envío o log se ejecuta si `contact.doNotContact = true`.
- **PG7 — Token refresh transparente.** Access tokens de Google expiran en 1 hora. El refresh se hace automáticamente en cada llamada API; si el refresh token es inválido, se notifica al asesor en `/settings` y se desactivan las funciones GW hasta que reconecte.
- **PG8 — Degradación suave.** Si `google_oauth_tokens` no tiene registro para el `userId`, los componentes GW simplemente no renderizan. Sin errores, sin prompts intrusivos.

---

## 2. MÓDULO GW-1 — Gmail Bidireccional

### 2.1 UX — Qué ve el asesor

**Panel del contacto (timeline):**
- Los emails aparecen como actividades de tipo `EMAIL_SENT` / `EMAIL_RECEIVED` en el timeline del contacto, mezclados cronológicamente con WhatsApp, llamadas y notas.
- Cada ítem de email muestra: asunto, preview de 2 líneas, fecha, dirección (enviado/recibido) y un botón "ver hilo completo" que expande el hilo inline.
- Hilos: si un email tiene respuestas, se agrupa bajo el mismo ítem con un contador `(3 mensajes)`.

**Redactar email desde el CRM:**
- En el panel del contacto, botón "Enviar email" (visible solo si el asesor tiene cuenta Gmail conectada).
- Abre un drawer con: To (prellenado con el email del contacto), asunto, cuerpo con soporte de rich text, firma del asesor (viene de `User.emailSignature`), opción de adjuntar plantilla (`EmailTemplate`).
- Al enviar: el email sale desde la cuenta Gmail del asesor (vía Gmail API `users.messages.send`), y el CRM registra automáticamente la actividad `EMAIL_SENT` en el timeline.

**Configuración en /settings:**
- Sección "Google Workspace" con estado: Conectado/Desconectado, email de la cuenta, última sync.
- Botón "Conectar cuenta Gmail" → inicia OAuth2 flow.
- Botón "Desconectar" → revoca tokens y borra registro.
- Toggle "Auto-log emails de este contacto" a nivel de contacto (default ON).

### 2.2 Flujo de log automático (INBOUND + OUTBOUND)

```
Gmail Pub/Sub push notification
  → POST /api/google/gmail/webhook
  → Verificar signature + userId
  → Fetch mensaje via Gmail API (users.messages.get)
  → Resolver contacto por email (from/to) contra tabla Contact
  → Si match: crear Activity(EMAIL_RECEIVED|EMAIL_SENT) + GmailThread upsert
  → Si doNotContact: descartar silenciosamente
  → Si no match: descartar (no creamos contactos fantasma desde Gmail)
```

**Polling fallback:** si Gmail Pub/Sub no está configurado (p.ej. ambiente local), un cron job cada 15 min hace `users.messages.list` con `q: after:{timestamp}` y procesa mensajes nuevos.

### 2.3 Contratos de API

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/google/oauth/connect` | Inicia OAuth2 flow (redirect a Google consent screen) |
| `GET` | `/api/google/oauth/callback` | Callback OAuth2, guarda tokens, redirect a /settings |
| `DELETE` | `/api/google/oauth/disconnect` | Revoca tokens y borra `google_oauth_tokens` |
| `GET` | `/api/google/oauth/status` | Devuelve estado de conexión del usuario actual |
| `POST` | `/api/google/gmail/webhook` | Recibe push notifications de Gmail Pub/Sub |
| `POST` | `/api/google/gmail/send` | Envía email via Gmail API del asesor |
| `GET` | `/api/google/gmail/threads/:threadId` | Devuelve mensajes de un hilo (para expand inline) |
| `POST` | `/api/google/gmail/sync/:userId` | Trigger manual de sync (admin o asesor desde /settings) |

**Body de `/api/google/gmail/send`:**
```ts
{
  contactId: string
  to: string           // email del destinatario
  subject: string
  body: string         // HTML permitido
  templateId?: string  // opcional, referencia a EmailTemplate
  dealId?: string      // opcional, para asociar al deal
}
```

**Response de `/api/google/gmail/threads/:threadId`:**
```ts
{
  threadId: string
  messages: Array<{
    messageId: string
    from: string
    to: string
    subject: string
    bodyText: string
    bodyHtml?: string
    date: string // ISO8601
    direction: 'INBOUND' | 'OUTBOUND'
  }>
}
```

### 2.4 Modelo de datos

**Nueva tabla: `google_oauth_tokens`**
```sql
CREATE TABLE propyte_crm.google_oauth_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES propyte_crm."User"(id) ON DELETE CASCADE,
  access_token    TEXT NOT NULL,          -- cifrado en reposo (AES-256)
  refresh_token   TEXT NOT NULL,          -- cifrado en reposo
  token_expiry    TIMESTAMPTZ NOT NULL,
  scope           TEXT NOT NULL,          -- scopes concedidos
  google_email    TEXT NOT NULL,          -- email de la cuenta Google conectada
  gmail_history_id TEXT,                  -- para delta sync de Gmail
  calendar_sync_token TEXT,              -- para delta sync de Calendar
  is_valid        BOOLEAN NOT NULL DEFAULT true, -- false si refresh falló
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Nueva tabla: `gmail_threads`**
```sql
CREATE TABLE propyte_crm.gmail_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES propyte_crm."Contact"(id) ON DELETE CASCADE,
  deal_id         UUID REFERENCES propyte_crm."Deal"(id) ON DELETE SET NULL,
  user_id         UUID NOT NULL REFERENCES propyte_crm."User"(id) ON DELETE CASCADE,
  thread_id       TEXT NOT NULL,          -- Gmail threadId
  message_count   INT NOT NULL DEFAULT 1,
  subject         TEXT,
  last_message_at TIMESTAMPTZ NOT NULL,
  direction       TEXT NOT NULL,          -- 'INBOUND' | 'OUTBOUND' | 'MIXED'
  snippet         TEXT,                   -- preview del último mensaje
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, thread_id)
);
```

**Extensión a `Activity` existente:**
```sql
-- Nuevas columnas en Activity para trazabilidad Google
ALTER TABLE propyte_crm."Activity"
  ADD COLUMN gmail_thread_id TEXT,         -- threadId de Gmail para dedup
  ADD COLUMN gmail_message_id TEXT,        -- messageId de Gmail para dedup
  ADD COLUMN google_event_id TEXT;         -- eventId de Calendar (GW-2)
```

### 2.5 Flujo OAuth2

Se usa **Web client** (server-side, con `client_secret`). No Desktop client — el flow necesita redirect_uri hacia el servidor Next.js.

```
1. Usuario en /settings → click "Conectar Gmail"
2. GET /api/google/oauth/connect
   → genera state (CSRF token), guarda en session
   → redirect a https://accounts.google.com/o/oauth2/v2/auth con:
      client_id, redirect_uri, scope, access_type=offline, prompt=consent, state
3. Google → redirect a /api/google/oauth/callback?code=...&state=...
4. Servidor: valida state, exchange code por tokens (access + refresh)
5. Cifra tokens → upsert google_oauth_tokens (userId UNIQUE)
6. Inicia historyId baseline (Gmail) + syncToken baseline (Calendar)
7. Registra watch en Gmail Pub/Sub → notificaciones push
8. Redirect a /settings con mensaje de éxito
```

**Refresh automático:**
```ts
async function getValidAccessToken(userId: string): Promise<string> {
  const record = await db.googleOAuthTokens.findUnique({ where: { userId } })
  if (!record?.isValid) throw new GWNotConnectedError()
  if (record.tokenExpiry > new Date(Date.now() + 60_000)) {
    return decrypt(record.accessToken)  // token vigente
  }
  // refresh
  const { access_token, expiry_date } = await oauth2Client.refreshToken(decrypt(record.refreshToken))
  await db.googleOAuthTokens.update({
    where: { userId },
    data: { accessToken: encrypt(access_token), tokenExpiry: new Date(expiry_date) }
  })
  return access_token
}
```

### 2.6 Decisiones clave

| Decisión | Elegida | Alternativa descartada | Por qué |
|---|---|---|---|
| Notificaciones Gmail | Pub/Sub push | Polling cada 5 min | Latencia <30s vs ~5min; menos cuota API |
| Almacenamiento de hilos | Tabla `gmail_threads` ligera | Guardar body completo en DB | El body se fetcha on-demand; evita DB inflada |
| Cifrado de tokens | AES-256 en columna | Hashicorp Vault / KMS | Proporcional al stack actual; KMS como upgrade futuro |
| Scope | `gmail.readonly + gmail.send` | `gmail.modify` | Principio de mínimo privilegio; no necesitamos mover/borrar emails |
| Match email→contacto | Solo por `Contact.email` exacto | Fuzzy match | Evitar falsos positivos; un email no identificado se descarta |

---

## 3. MÓDULO GW-2 — Google Calendar

### 3.1 UX — Qué ve el asesor

**Panel del deal / contacto:**
- Bloque "Próximas reuniones" con las reuniones asociadas al contacto (fetched de `Activity` tipo MEETING con `google_event_id`).
- Botón "Agendar reunión" → abre modal con: título, fecha/hora, duración, descripción (prellenada con nombre del contacto + desarrollo de interés), opción de enviar invitación al contacto (Google Meet link o solo notificación).
- Al guardar: crea `Activity(MEETING_VIRTUAL|MEETING_PRESENTIAL)` en el CRM + crea evento en Google Calendar del asesor vía API. Si el asesor marcó "Invitar al contacto", el contacto queda como attendee del evento de Google.

**Vista de Agenda en CRM:**
- En el sidebar o como tab en el dashboard: lista de próximas reuniones del asesor (próximas 7 días), ordenadas cronológicamente, con link al deal/contacto asociado.
- Fuente: `Activity` tipo MEETING con `google_event_id` vigente + fetch de eventos nuevos desde Calendar (sync inverso).

**Sync inverso (Calendar → CRM):**
- Si el asesor crea un evento en Google Calendar que incluye el email de un contacto del CRM como attendee, el CRM lo detecta, crea la `Activity(MEETING_VIRTUAL)` y la asocia al contacto.
- La detección es best-effort: si el asunto o los attendees no matchean un contacto conocido, el evento se ignora silenciosamente.

### 3.2 Contratos de API

| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/google/calendar/events` | Crea evento en Google Calendar + Activity en CRM |
| `PATCH` | `/api/google/calendar/events/:eventId` | Edita evento (fecha, hora, descripción) |
| `DELETE` | `/api/google/calendar/events/:eventId` | Cancela evento + actualiza Activity |
| `GET` | `/api/google/calendar/upcoming` | Lista próximas reuniones del asesor (7 días) |
| `POST` | `/api/google/calendar/webhook` | Recibe push notifications de Calendar (cambios externos) |
| `POST` | `/api/google/calendar/sync/:userId` | Sync manual / rebuild desde Calendar |

**Body de `/api/google/calendar/events` (POST):**
```ts
{
  contactId: string
  dealId?: string
  title: string
  startTime: string     // ISO8601
  endTime: string       // ISO8601
  description?: string
  meetingType: 'MEETING_VIRTUAL' | 'MEETING_PRESENTIAL' | 'MEETING_SHOWROOM'
  inviteContact: boolean  // si true → contacto como attendee
  location?: string
}
```

**Response:**
```ts
{
  activityId: string
  googleEventId: string
  googleMeetLink?: string  // si Calendar crea Meet automáticamente
  calendarLink: string     // link para abrir en Google Calendar
}
```

### 3.3 Modelo de datos

No requiere tabla nueva — se extiende el esquema existente:

```sql
-- La columna google_event_id ya se agrega en la migración GW-1 (§2.4)
-- Columna adicional en Activity para el link de Meet
ALTER TABLE propyte_crm."Activity"
  ADD COLUMN google_meet_link TEXT,
  ADD COLUMN calendar_link    TEXT;
```

**Nueva tabla: `google_calendar_watches`** (para gestionar push channels)
```sql
CREATE TABLE propyte_crm.google_calendar_watches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES propyte_crm."User"(id) ON DELETE CASCADE,
  channel_id    TEXT NOT NULL,     -- UUID generado por nosotros al registrar el watch
  resource_id   TEXT NOT NULL,     -- resourceId devuelto por Google
  expiration    TIMESTAMPTZ NOT NULL,  -- watches expiran en ~7 días, hay que renovar
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.4 Flujo de creación de reunión (CRM → Calendar)

```
Asesor completa modal "Agendar reunión"
  → POST /api/google/calendar/events
  → Server: getValidAccessToken(userId)
  → calendar.events.insert(calendarId='primary', resource={...})
  → Recibe googleEventId + hangoutLink (si Meet)
  → Crea Activity en CRM con google_event_id, google_meet_link, calendar_link
  → Encola en action_queue: notificar al contacto (WhatsApp/email) si inviteContact=true
  → Responde al cliente con activityId + googleEventId
```

### 3.5 Sync inverso (Calendar → CRM)

```
Google Calendar → push notification → POST /api/google/calendar/webhook
  → Verifica channel_id + resourceId contra google_calendar_watches
  → Fetch eventos modificados via calendar.events.list(syncToken)
  → Por cada evento nuevo/modificado:
      → Buscar attendee emails en Contact (exact match)
      → Si match y no existe Activity con google_event_id:
          → Crear Activity(MEETING_VIRTUAL) asociada al contacto
      → Si match y Activity existe:
          → Actualizar fecha/hora/status si cambió
      → Actualizar calendar_sync_token en google_oauth_tokens
```

### 3.6 Renovación de watches

Los Calendar push channels expiran en ~7 días. Un cron job diario revisa `google_calendar_watches` con `expiration < now() + 2 días` y renueva el watch. Si falla, `is_valid` en `google_oauth_tokens` no se altera — solo se pierde el sync inverso hasta que el asesor reconecte.

### 3.7 Decisiones clave

| Decisión | Elegida | Alternativa descartada | Por qué |
|---|---|---|---|
| Sync inverso | Push notifications + syncToken | Polling cada X min | Paridad en latencia con Gmail |
| Calendarios | Solo `primary` del asesor | Calendarios compartidos del equipo | Principio de mínimo scope; los secundarios son opt-in futuro |
| Meet links | Dejar que Calendar genere | Crear via Meet API separado | Calendar.insert con `conferenceData` lo hace en 1 llamada |
| Cancelación | Soft-delete (status=cancelled) en ambos lados | Solo en CRM | Evitar fantasmas en el calendario del asesor |

---

## 4. MÓDULO GW-3 — Google Contacts

### 4.1 UX — Qué ve el asesor

**Comportamiento automático (invisible):**
- Cuando el asesor crea un `Contact` nuevo en el CRM (o cuando el sistema importa un lead), se encola una acción para crear el contacto en Google Contacts del asesor asignado.
- El asesor puede buscar al contacto en su app de Contacts/Gmail y encontrará los datos del CRM.
- No hay UI especial para este módulo — ocurre en background.

**En el panel del contacto (solo lectura):**
- Badge pequeño "En Google Contacts" si el contacto fue sincronizado (`google_contact_id` no null).
- Botón "Sincronizar ahora" para forzar un re-push si los datos del CRM cambiaron.

**Sin sync inverso por defecto:**
- Si el asesor edita el contacto en Google, esos cambios **no** sobreescriben el CRM. El CRM es el SOT.
- Rationale: evitar que cambios accidentales en el teléfono del asesor corrompan datos del CRM.

### 4.2 Contratos de API

| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/google/contacts/push/:contactId` | Push manual de un contacto al Google Contacts del asesor |
| `PUT` | `/api/google/contacts/push/:contactId` | Re-sync (update) de datos del contacto existente |
| `DELETE` | `/api/google/contacts/:googleContactId` | Elimina de Google Contacts si se elimina del CRM |

> Nota: la creación automática al crear un `Contact` no tiene endpoint propio — se dispara via `action_queue` desde el service layer de Contact.

### 4.3 Modelo de datos

**Extensión a `Contact` existente:**
```sql
ALTER TABLE propyte_crm."Contact"
  ADD COLUMN google_contact_id TEXT,         -- resourceName de People API (ej. "people/c123")
  ADD COLUMN google_contact_synced_at TIMESTAMPTZ;  -- última sync exitosa
```

### 4.4 Flujo de creación (CRM → Google Contacts)

```
createContact() en CRM service layer
  → POST /api/contacts (existente)
  → Contact creado en DB
  → Si asesor asignado tiene google_oauth_tokens válido:
      → Encolar en action_queue: { type: 'GW_CONTACTS_PUSH', contactId, assignedUserId }
  → action_queue worker ejecuta:
      → getValidAccessToken(assignedUserId)
      → people.createContact(resource={
          names: [{ givenName, familyName }],
          emailAddresses: [{ value: email }],
          phoneNumbers: [{ value: phone }],
          organizations: [{ name: company }]
        })
      → Guarda resourceName en Contact.google_contact_id
      → Actualiza google_contact_synced_at
```

**Re-sync al actualizar datos del contacto:**
Si `Contact.email`, `Contact.phone`, `Contact.firstName` o `Contact.lastName` cambian, y `Contact.google_contact_id` no es null, se encola `GW_CONTACTS_UPDATE`.

### 4.5 Decisiones clave

| Decisión | Elegida | Alternativa descartada | Por qué |
|---|---|---|---|
| Scope | `contacts.readwrite` (mínimo para crear) | Full contacts scope | Solo necesitamos crear/actualizar nuestros propios contactos |
| Asesor dueño del contacto | Asesor asignado al contacto | Cuenta organizacional | PG1 — por asesor, no por org |
| Sync inverso | Desactivado por defecto | Bidireccional completo | CRM es SOT; riesgo de corrupción de datos |
| Scope en OAuth | El mismo token de GW-1/GW-2 | Token separado por módulo | Un solo consent screen; scopes acumulativos en el mismo registro |

---

## 5. COMPONENTES COMPARTIDOS

### 5.1 GoogleWorkspaceService

Clase singleton (`/lib/google/workspace.service.ts`) que:
- Instancia `google.auth.OAuth2` con las credenciales de la app.
- Expone `getValidAccessToken(userId)` con refresh automático (§2.5).
- Maneja `GWNotConnectedError` y `GWTokenExpiredError` para degradación suave en el resto de la app.
- Expone clientes: `getGmailClient(userId)`, `getCalendarClient(userId)`, `getPeopleClient(userId)`.

### 5.2 action_queue — tipos de acciones GW

Los workers del motor de workflows existente atienden estos nuevos tipos:

```ts
type GWActionType =
  | 'GW_GMAIL_LOG_INBOUND'
  | 'GW_GMAIL_LOG_OUTBOUND'
  | 'GW_CALENDAR_CREATE'
  | 'GW_CALENDAR_UPDATE'
  | 'GW_CALENDAR_CANCEL'
  | 'GW_CONTACTS_PUSH'
  | 'GW_CONTACTS_UPDATE'
  | 'GW_CONTACTS_DELETE'
  | 'GW_TOKEN_REFRESH'
  | 'GW_WATCH_RENEW'
```

Cada acción incluye `userId` para seleccionar el token correcto. Retry policy: 3 intentos con backoff exponencial (10s, 60s, 300s). En fallo definitivo: marcar `is_valid = false` si el error es 401, notificar al asesor.

### 5.3 Cifrado de tokens

Usar `@node-rs/bcrypt` / `crypto` nativo de Node:
- Clave de cifrado: `GOOGLE_TOKEN_ENCRYPTION_KEY` (env var, 32 bytes hex).
- Algoritmo: AES-256-GCM con IV aleatorio por token.
- IV y auth tag se almacenan como prefijo del ciphertext en la misma columna (formato: `iv:tag:ciphertext` en base64).

---

## 6. MIGRATIONS SQL (resumen)

Todas las migrations van en `/prisma/migrations/` con prefijo de fecha.

### Migration 1 — `google_oauth_tokens`
```sql
-- Ver §2.4 — tabla completa
CREATE TABLE propyte_crm.google_oauth_tokens (...);
CREATE INDEX idx_google_oauth_tokens_user_id ON propyte_crm.google_oauth_tokens(user_id);
```

### Migration 2 — `gmail_threads`
```sql
-- Ver §2.4 — tabla completa
CREATE TABLE propyte_crm.gmail_threads (...);
CREATE INDEX idx_gmail_threads_contact_id ON propyte_crm.gmail_threads(contact_id);
CREATE INDEX idx_gmail_threads_user_thread ON propyte_crm.gmail_threads(user_id, thread_id);
```

### Migration 3 — `google_calendar_watches`
```sql
-- Ver §3.3 — tabla completa
CREATE TABLE propyte_crm.google_calendar_watches (...);
```

### Migration 4 — extensiones a tablas existentes
```sql
-- Activity
ALTER TABLE propyte_crm."Activity"
  ADD COLUMN gmail_thread_id    TEXT,
  ADD COLUMN gmail_message_id   TEXT UNIQUE,
  ADD COLUMN google_event_id    TEXT UNIQUE,
  ADD COLUMN google_meet_link   TEXT,
  ADD COLUMN calendar_link      TEXT;

-- Contact
ALTER TABLE propyte_crm."Contact"
  ADD COLUMN google_contact_id         TEXT UNIQUE,
  ADD COLUMN google_contact_synced_at  TIMESTAMPTZ;
```

### Migration 5 — enum extension
```sql
-- ActivityType ya tiene EMAIL_SENT / EMAIL_RECEIVED — no se agrega nada.
-- Si no existieran, se agregarían aquí.
-- Verificar antes de ejecutar: están en schema.prisma líneas 285-290 ✓
```

---

## 7. CONFIGURACIÓN — Variables de entorno requeridas

```bash
# Google OAuth2 (Web client — Google Cloud Console)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://crm.propyte.com/api/google/oauth/callback

# Gmail Pub/Sub
GOOGLE_PUBSUB_TOPIC=projects/{project-id}/topics/gmail-notifications
GOOGLE_PUBSUB_SUBSCRIPTION=projects/{project-id}/subscriptions/gmail-notifications-sub

# Cifrado de tokens
GOOGLE_TOKEN_ENCRYPTION_KEY=<32-bytes-hex>

# Calendar push (debe ser HTTPS público — no localhost)
GOOGLE_CALENDAR_WEBHOOK_URL=https://crm.propyte.com/api/google/calendar/webhook
```

---

## 8. ORDEN DE IMPLEMENTACIÓN

### Fase GW-0 — Infra OAuth (prerequisito de todo)
1. Crear proyecto en Google Cloud Console, habilitar Gmail API + Calendar API + People API.
2. Crear OAuth2 Web client, configurar pantalla de consentimiento con scopes.
3. Implementar `GoogleWorkspaceService` (`getValidAccessToken`, clientes, error handling).
4. Ejecutar Migration 1 (`google_oauth_tokens`).
5. Implementar `/api/google/oauth/*` (connect, callback, disconnect, status).
6. UI en `/settings` — sección Google Workspace (conectar/desconectar, estado).
7. **Gate:** un asesor puede conectar/desconectar su cuenta desde /settings. Sin este gate no avanza nada.

### Fase GW-1 — Gmail
1. Migration 2 (`gmail_threads`) + Migration 4 columnas en Activity.
2. Implementar `GW_GMAIL_LOG_*` workers en action_queue.
3. Registrar Gmail Pub/Sub watch al conectar cuenta; renovación automática.
4. Implementar `/api/google/gmail/webhook` (procesar push notifications).
5. Implementar `/api/google/gmail/send` + componente de redactar email.
6. Implementar `/api/google/gmail/threads/:threadId` + expand inline en timeline.
7. Renderizar emails en timeline del contacto.

### Fase GW-2 — Calendar
1. Migration 3 (`google_calendar_watches`) + Migration 4 columnas en Activity.
2. Implementar `GW_CALENDAR_*` workers en action_queue.
3. Registrar Calendar watch al conectar cuenta; cron de renovación.
4. Implementar `/api/google/calendar/events` (CRUD) + modal "Agendar reunión".
5. Implementar `/api/google/calendar/webhook` (sync inverso).
6. Implementar `/api/google/calendar/upcoming` + vista de agenda en dashboard.

### Fase GW-3 — Contacts
1. Migration 4 columnas en Contact.
2. Implementar `GW_CONTACTS_*` workers en action_queue.
3. Hook en `createContact` / `updateContact` service layer para encolar push.
4. Badge "En Google Contacts" + botón "Sincronizar ahora" en panel de contacto.

> **Orden fijo:** GW-0 → GW-1 → GW-2 → GW-3. El OAuth de GW-0 es prerequisito de todo. GW-1 antes de GW-2 porque el timeline de emails es el valor más visible para el equipo de ventas.

---

## 9. OPEN QUESTIONS

1. **Gmail Pub/Sub en producción:** ¿el proyecto de GCP ya existe o hay que crearlo? Pub/Sub requiere que el endpoint sea HTTPS público — confirmar que `crm.propyte.com` tiene el dominio verificado en Google Cloud.
2. **Scope `contacts.readwrite` vs `contacts.readonly`:** GW-3 necesita crear contactos (`readwrite`). Si el equipo prefiere `readonly` por política, GW-3 se omite o se hace solo lectura.
3. **Asesor reasignado:** si un deal se reasigna a otro asesor, ¿los eventos de Calendar del asesor anterior se transfieren? ¿O simplemente quedan huérfanos?
4. **Hilos de email multi-asesor:** si dos asesores intercambian emails con el mismo contacto, ¿cada uno ve sus hilos o hay una vista unificada? Propuesta: cada asesor ve sus hilos; el contacto muestra todos bajo un tab "Emails (todos los asesores)" para ADMIN.
5. **Datos de Google en DB:** ¿se debe guardar el cuerpo del email en la DB para búsqueda/auditoría, o solo el snippet + fetch on-demand? Trade-off: almacenamiento vs latencia de consulta.
6. **Contacto sin email asignado (walk-in):** ¿el log de Gmail aplica? Probablemente no — requiere email válido para hacer match. Confirmar comportamiento esperado.
7. **Entorno staging:** el redirect_uri de OAuth debe coincidir exactamente. Se necesita un segundo Web client en GCP para staging o una configuración multi-redirect.
8. **Retención de tokens:** cuando un asesor sale de la empresa, ¿se revocan sus tokens automáticamente al desactivar su cuenta? Confirmar flujo de offboarding.

*Fin — Speckit Google Workspace v1.0.*
