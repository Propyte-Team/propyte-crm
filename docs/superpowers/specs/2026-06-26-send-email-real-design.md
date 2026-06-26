# SEND_EMAIL real (Fase 3 sub-E1) — Diseño

**Fecha:** 2026-06-26
**Sub-proyecto:** Fase 3 — E1 (email en vivo). MAKE_CALL = E2 aparte (tarea + click-to-call, no en este spec).
**Rama:** `feat/crm-email-send` (worktree `.claude/worktrees/crm-email-send`, desde `origin/main` `0a90ebf`)
**Estado:** aprobado por Luis (brainstorming)

## Problema

La acción de workflow `SEND_EMAIL` hoy es **no-op** (`actions.ts` devuelve `{ skipped: true, note: "SEND_EMAIL se habilita con F5 (firma/alias)" }`). El motor (reglas + cadencias) puede encolar `SEND_EMAIL` pero nunca manda correo. Hay que hacer que **ejecute de verdad**, reusando la infraestructura ya construida.

## Decisión de transporte (confirmada)

**Gmail del asesor asignado + fallback SMTP.** Si el asesor dueño del contacto tiene Google conectado, el correo sale desde su Gmail (con su alias `sendAs` + firma de su perfil, y queda logueado en el hilo). Si no, cae a un remitente SMTP compartido.

## Infraestructura existente (reusar, no reconstruir)

- `src/lib/google/gmail.ts`: `sendGmail(opts)` (envía vía Gmail API del usuario y **logea el saliente al hilo**), `renderEmailTemplate(...)`, `listSendAsAddresses(userId)`, `logOutboundSend(...)`.
- `src/lib/google/workspace.service.ts`: `getConnectionStatus(userId)` (¿Google conectado?), `getGmailClient(userId)`.
- `prisma`: `GoogleOAuthToken` (token por usuario), `UserTemplate` (channel `EMAIL`, campos `subject?`/`body`/`language`/`isActive`), `UserProfile` (firma/alias, F5), `Activity` (timeline del contacto).
- `src/lib/email/mailer.ts`: transporter Nodemailer ya configurado, pero solo funciones transaccionales (`sendLoginCode`, etc.) — **falta un envío genérico** para el fallback.
- `actions.ts`: helpers `ownerUserId(contact)` (asesor dueño o admin), `renderTemplateBody(...)` (patrón de variables de SEND_WHATSAPP), `loadContact(item)`.

## Componentes

### 1. Resolución de contenido — `resolveEmailContent` (puro, testeable)

Entrada: `config` de la acción + `contact` + `language`. Lógica:
- Si `config.template` (string ref): cargar `UserTemplate` activo con `channel="EMAIL"`, idioma del contacto (fallback ES), match por `id` o `name` → tomar `subject` + `body`.
- Si no hay template: usar `config.subject` (string) + `config.body` (string) inline.
- Render de variables sobre subject y body (`{{contact.firstName}}`, `{{contact.lastName}}`, …) con el mismo criterio que `renderTemplateBody` (variable sin resolver en el cuerpo → se quita la línea; en el subject → se reemplaza por vacío).
- Devuelve `{ subject, body }`. Si no hay `body` resoluble o no hay subject → `null` (el runner hace skip con nota).

> La carga de `UserTemplate` es BD; para mantener `resolveEmailContent` puro y testeable, recibe el template ya cargado (o `null`) como argumento: `resolveEmailContent({ template, configSubject, configBody, contact }) → {subject, body} | null`. El runner hace el `prisma.userTemplate.findFirst` y se lo pasa.

### 2. Resolución de remitente — `resolveEmailSender` (con BD)

`resolveEmailSender(contact) → { kind: "gmail" | "smtp"; userId: string | null }`:
- `userId = await ownerUserId(contact)` (el asesor dueño; puede ser null).
- Si `userId` y `await getConnectionStatus(userId)` indica conectado → `{ kind:"gmail", userId }`.
- Si no → `{ kind:"smtp", userId }` (se conserva el `userId` del dueño para tomar su firma, aunque no tenga Google).
- (Helper testeable mockeando `getConnectionStatus`.)

### 3. Envío SMTP genérico — `sendSmtpEmail` (nuevo en `mailer.ts`)

`sendSmtpEmail({ to, subject, text, fromName? })`: reusa el transporter existente de `mailer.ts`, `from` = `\`${fromName ?? "Propyte"} <${process.env.EMAIL_FROM}>\`` (remitente compartido por env). Envía texto plano. Lanza si el transporter falla (el runner lo captura → reintento de la cola).

### 4. Orquestación — case `SEND_EMAIL` en `actions.ts`

Reemplaza el no-op:
1. `contact` ya cargado; si `!contact?.email` → skip "sin email"; si `contact.doNotContact` → skip "opt-out" (ya presentes).
2. Cargar template si `config.template`; `content = resolveEmailContent(...)`; si `null` → skip "sin contenido".
3. `sender = await resolveEmailSender(contact)`.
4. Firma: si `sender.userId`, cargar `UserProfile.signature` y anexarla al body (en AMBOS paths, para consistencia).
5. **Gmail:** `sendGmail({ userId: sender.userId, to: contact.email, subject, text: bodyConFirma, ... })` (usa su alias `sendAs`; ya logea el saliente al hilo del contacto).
6. **SMTP:** `sendSmtpEmail({ to: contact.email, subject, text: bodyConFirma, fromName: nombreDelAsesor })`; luego crear una `Activity` tipo EMAIL en el contacto (asunto + a quién) para que aparezca en el timeline (el path Gmail no la necesita porque el hilo ya lo registra).
7. Devuelve `{}` en éxito, `{ skipped, note }` en los skips.

Texto plano (sin HTML rico). Opt-out y email faltante respetados.

## Pruebas

- **Unit `resolveEmailContent`:** template (subject+body), inline (config), variables resueltas y línea quitada si falta var, sin body → null.
- **Unit `resolveEmailSender`:** owner con Google conectado → gmail; sin conexión / sin owner → smtp (mock `getConnectionStatus` + `ownerUserId`/prisma).
- **Unit `sendSmtpEmail`:** construye el `from` con `EMAIL_FROM` + fromName y llama al transporter (mock del transporter; verificar args).
- (El envío Gmail real se cubre por los tests existentes de `gmail.ts`; aquí se mockea `sendGmail`.)
- **Sin migración** (todas las tablas existen). No toca el motor (solo el runner de la acción + un helper nuevo en mailer.ts). Build + suite verdes. ff-push a main → auto-deploy.

## Variables de entorno

- `EMAIL_FROM` (remitente del fallback SMTP). Si falta, el fallback SMTP hace skip con nota (no crashea). El transporter SMTP ya está configurado en `mailer.ts` (mismas credenciales que login/reset).

## Fuera de alcance (futuro)

- **MAKE_CALL (E2):** tarea de llamada al asesor + click-to-call Twilio (decisión de Luis para E2).
- HTML rico / plantillas con diseño, adjuntos, tracking de apertura/clicks, threading de respuestas entrantes a la cadencia.

## Notas

- El path Gmail depende de que el asesor tenga Google conectado (token vigente; `getValidAccessToken` refresca). Si el token está revocado, `sendGmail` lanzará → la cola reintenta; si persiste, la acción queda FAILED (visible en `action_queue`). Aceptable v1.
- Idempotencia: la cola (`action_queue` + claim optimista + dedupeKey) evita doble-envío; el runner no agrega dedup propio.
