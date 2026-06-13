# Diseño — Integración Gmail (Entregable B: GW-0 + GW-1)

> **Fecha:** 2026-06-13
> **Stack:** propyte-crm (Next.js 14.2.21 + Prisma multiSchema + NextAuth + vitest)
> **Base spec:** `specs/SPECKIT-GOOGLE-WORKSPACE.md` (este doc captura decisiones, alcance y puntos de integración reales; el speckit es la fuente del contrato de API y modelo de datos).
> **Relación:** Entregable B (Gmail). El A (actividades) ya está en prod; los correos caen en el mismo `ActivityLog`.

---

## 1. Alcance

**DENTRO:** GW-0 (infra OAuth) + GW-1 (Gmail bidireccional: enviar desde el CRM, auto-log de entrantes/salientes como `Activity(EMAIL_*)`, hilos, expand inline).
**FUERA (otro ciclo):** GW-2 Calendar, GW-3 Contacts.

**Orden fijo (speckit §8):** GW-0 es la puerta — sin conectar/desconectar cuenta no avanza nada. Se implementa, verifica y luego GW-1.

---

## 2. Decisiones (cierran open questions del speckit)

| Tema | Decisión |
|---|---|
| OAuth client | **Web client** server-side. Luis YA tiene `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Él configura redirect URIs en GCP: prod `https://crm.propyte.com/api/google/oauth/callback` (+ `http://localhost:3001/...` para pruebas locales si quiere). |
| Inbound Gmail | **Pub/Sub push** (decisión de Luis) → `/api/google/gmail/webhook`. Requiere tópico Pub/Sub en GCP. Se incluye además un **cron de respaldo** (`x-cron-secret`) para `users.history.list`/polling cuando Pub/Sub no esté disponible (p.ej. local). |
| Cifrado de tokens | Archivo paralelo `src/lib/crypto-google.ts` (mismo AES-256-GCM `v1:iv:tag:ct` que `crypto.ts`) leyendo **`GOOGLE_TOKEN_ENCRYPTION_KEY`** — aislamiento de llaves respecto a KYC. |
| Scopes (PG5 mínimo) | `gmail.readonly`, `gmail.send`. `access_type=offline`, `prompt=consent`. Nada de drive/admin/calendar/contacts. |
| Cuerpo del email | **Snippet + headers en DB; cuerpo on-demand** vía Gmail API (speckit §2.6). Tabla `gmail_threads` ligera. |
| Match email→contacto | **Exacto** contra `Contact.email`. Sin match → se descarta (no se crean contactos fantasma). `doNotContact` → se descarta. |
| Hilos multi-asesor (OQ4) | v1 simple: los correos se registran como `Activity(EMAIL_*)` del contacto y aparecen en su `ActivityLog` (compartido por todos los que ven el contacto, igual que cualquier actividad). El expand de hilo usa `gmail_threads` + fetch on-demand de los mensajes del asesor dueño del token. Sin tab separado por asesor en v1. |
| Firma / plantillas | `UserProfile.emailSignatureHtml` + `emailFromAlias` (hoy columnas muertas) se usan al redactar. Plantillas `UserTemplate channel=EMAIL`. |
| Migración DDL | Se escribe el SQL; **Luis lo aplica** en la Supabase compartida (regla [[feedback_autorizacion_explicita_infra]]). `prisma generate` local crea el cliente. La app **degrada suave** (PG8): sin tabla/sin token → funciones GW no renderizan / errores atrapados. |
| State CSRF OAuth | Cookie httpOnly firmada (no la sesión NextAuth-JWT), seteada en `connect`, verificada en `callback`. |

---

## 3. Puntos de integración (código real, del recon)

- **Crypto:** `src/lib/crypto.ts` exporta `encryptPII`/`decryptPII` (AES-256-GCM, key lazy `KYC_ENCRYPTION_KEY`). → clonar a `crypto-google.ts` con `GOOGLE_TOKEN_ENCRYPTION_KEY`.
- **Sesión:** `getServerSession()` de `@/lib/auth/session`; `session.user = {id, email, name, role, plaza, careerLevel}`.
- **Settings:** `src/components/settings/settings-view.tsx` (TABS array + bloques `crm-card`; fetch `/api/profile`). → agregar tab `google`.
- **Perfil API:** `src/app/api/profile/route.ts` (GET/PATCH `userProfile`).
- **action_queue (GW-1):** enum Prisma `WorkflowActionType` (`schema.prisma:442-461`); dispatch `executeAction` switch en `src/lib/workflows/actions.ts:66`; encolar con `enqueueAction` (`src/lib/workflows/queue.ts:11`).
- **Cron:** patrón `x-cron-secret` (`process.env.CRON_SECRET`), ej. `src/app/api/cron/workflows/route.ts:51`.
- **Prisma:** multiSchema, `@@schema("propyte_crm")` en modelos y enums.
- **Paquetes:** instalar `googleapis` + `google-auth-library` (no están). Next 14.2.21.

---

## 4. GW-0 — Infra OAuth (la puerta)

### 4.1 Unidades
- `src/lib/crypto-google.ts` (+ test) — `encryptGoogleToken`/`decryptGoogleToken`.
- **Prisma model `GoogleOAuthToken`** (`@@map("google_oauth_tokens")`, `@@schema("propyte_crm")`): campos del speckit §2.4 (`userId @unique`, `accessToken`, `refreshToken` (cifrados), `tokenExpiry`, `scope`, `googleEmail`, `gmailHistoryId?`, `isValid`, `connectedAt`, `lastUsedAt?`, timestamps). SQL en `prisma/migrations-manual/2026-06-13-gw0-google-oauth.sql` (Luis aplica).
- `src/lib/google/workspace.service.ts` — `GoogleWorkspaceService`: `getOAuthClient()` (lee `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`), `getValidAccessToken(userId)` (refresh automático + `isValid=false` si refresh 401), `getGmailClient(userId)` (para GW-1), `getConnectionStatus(userId)`. Errores `GWNotConnectedError`.
- Rutas `/api/google/oauth/`: `connect` (genera state→cookie httpOnly, redirect a consent con scopes+offline+consent), `callback` (valida state, exchange code, cifra+upsert token, redirect `/settings?google=connected`), `disconnect` (revoca en Google + borra registro), `status` (estado de conexión del usuario).
- **Settings UI:** tab "Google Workspace" en `settings-view.tsx` — estado (Conectado/Desconectado, email, última conexión), botón Conectar (link a `/api/google/oauth/connect`), botón Desconectar.
- `.env.example`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY`.

### 4.2 Gate de aceptación
Un asesor entra a `/settings` → Google Workspace → Conectar → consiente en Google → vuelve a `/settings` mostrando "Conectado: <email>". Desconectar borra el registro. (Requiere que Luis aplique la migración + ponga las 4 env vars.)

### 4.3 Pruebas
- vitest: `crypto-google.test.ts` (roundtrip, IV aleatorio, null-safe, tamper, falta-llave) espejo de `crypto.test.ts`.
- `npm run build` verde. OAuth flow real lo valida Luis tras configurar GCP (no automatizable headless — consent screen de Google).

---

## 5. GW-1 — Gmail (resumen; plan detallado aparte tras GW-0 verde)
- Prisma `GmailThread` + columnas en `Activity` (`gmailThreadId`, `gmailMessageId @unique`, `googleEventId @unique` reservada para GW-2). SQL → Luis aplica.
- Enum `WorkflowActionType` += `GW_GMAIL_LOG_INBOUND`, `GW_GMAIL_LOG_OUTBOUND`; handlers en `actions.ts`.
- `/api/google/gmail/send` (envía vía Gmail del asesor + crea `Activity(EMAIL_SENT)`), `/api/google/gmail/webhook` (Pub/Sub push → resolver contacto → log), `/api/google/gmail/threads/[threadId]` (mensajes on-demand).
- Cron respaldo `/api/cron/google/gmail-sync` (history.list/polling).
- UI: botón "Enviar email" + drawer (To prellenado, asunto, cuerpo, firma, plantilla EMAIL) integrado en `ActivityLog`; ítems `EMAIL_*` con expand de hilo inline.

---

## 6. Fuera de alcance
- GW-2 Calendar, GW-3 Contacts.
- Verificación headless del consent de Google (manual, Luis).
- No se aplican migraciones autónomamente (Luis aplica DDL en Supabase compartida).
