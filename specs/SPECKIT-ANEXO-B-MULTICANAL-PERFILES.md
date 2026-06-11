# ANEXO B — Conectores de Leads (Meta/TikTok) · Inbox WhatsApp con Takeover · Perfiles de Usuario

> **Complementa** al `SPECKIT-PROPYTE-CRM-CONSOLIDADO.md` v1.1 y al `SPECKIT-ANEXO-TECNICO.md` v1.0.
> Cubre los 3 requerimientos nuevos de Luis (2026-06-10):
> 1. Conexión **directa** a Leads de Meta y Leads de TikTok.
> 2. **Chatbot estilo WhatsApp** donde el asesor puede **tomar el control**.
> 3. **Perfiles de usuario** separados: correos, tarjetas de presentación, plantillas, cadencias.
>
> **Versión:** 1.0 — 2026-06-10 · Aprobado por Luis (sesión 2026-06-10: "Apruebo el speckit que vayas a sacar")

---

## H. CONECTORES DE LEADS (Meta Lead Ads · TikTok Lead Gen · Web)

### H.0 Decisión de arquitectura (resuelve tensión con §3.4 del consolidado)

El consolidado dice "el CRM consume Meta leads desde el Hub". Eso aplica al pipeline de
**reporting/conciliación** (cron 15-30 min del Hub, matching vs Zoho) — demasiado lento para
el SLA de speed-to-lead <5 min (P2). Por eso el CRM tiene **conectores de intake en tiempo real**:

- **Hub** = reporting, conciliación histórica, dashboards Meta (sin cambios).
- **CRM** = intake en vivo vía webhook (Meta) / pull corto (TikTok) → `captureLead` → ruteo + SLA.
- **Anti-doble-alta:** `connector_lead_log.externalLeadId` es UNIQUE por conector; y `captureLead`
  deduplica por teléfono E.164 / email. Si el Hub después concilia el mismo lead, lo encuentra
  ya creado (match por teléfono) — no se duplica.

### H.1 `lead_connectors` — NUEVA entidad

| Campo | Tipo | Req | Default | Notas |
|---|---|---|---|---|
| id | uuid | sí | uuid() | PK |
| name | String | sí | — | ej. "Meta — Página Propyte", "TikTok — Nativa Tulum" |
| provider | ConnectorProvider | sí | — | `META` / `TIKTOK` / `WEBSITE` / `ZAPIER` / `MANUAL` |
| status | ConnectorStatus | sí | PAUSED | `ACTIVE` / `PAUSED` / `ERROR` |
| credentials | Json (cifrado a nivel app) | no | — | META: `pageId`, `pageAccessToken`(long-lived), `appSecret`, `verifyToken` · TIKTOK: `advertiserId`, `accessToken`, `appId`, `secret` |
| config | Json | sí | {} | `formIds[]` (vacío = todos), `defaultLeadSource` (FACEBOOK_ADS / TIKTOK→OTRO+detail), `defaultPlaza`, `languageDetect` bool |
| fieldMap | Json | sí | {} | mapa campo-externo → campo-Contact. ej. `{"full_name":"fullName","phone_number":"phone","email":"email","¿presupuesto?":"leadSourceDetail"}` |
| lastLeadAt | DateTime? | no | — | último lead recibido |
| lastSyncAt | DateTime? | no | — | TikTok pull: última corrida |
| errorCount | Int | sí | 0 | se resetea en éxito |
| lastError | String? @db.Text | no | — | |
| createdAt/updatedAt/deletedAt | DateTime | — | — | convenciones §A |

### H.2 `connector_lead_logs` — NUEVA entidad (idempotencia + replay + auditoría)

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| connectorId | uuid FK | → lead_connectors |
| externalLeadId | String | `@@unique([connectorId, externalLeadId])` — **garantía de idempotencia** |
| rawPayload | Json | payload completo del proveedor (replay/debug) |
| contactId | uuid? FK | contacto creado/matcheado |
| status | ConnectorLeadStatus | `RECEIVED` / `PROCESSED` / `DUPLICATE` / `ERROR` |
| errorDetail | String? @db.Text | |
| receivedAt | DateTime @default(now()) | |
| processedAt | DateTime? | |

### H.3 Protocolo Meta Lead Ads (tiempo real)

```
1. Configuración (una vez, UI /admin → Integraciones → Conectores):
   - App de Meta con producto Webhooks + leadgen permission (leads_retrieval)
   - Page Access Token long-lived guardado cifrado en credentials
   - Webhook subscription: objeto `page`, campo `leadgen`, callback:
     POST https://crm.propyte.com/api/connectors/meta/webhook
2. Verificación GET (challenge): Meta manda hub.mode=subscribe&hub.verify_token&hub.challenge
   → responder challenge si verify_token coincide con credentials.verifyToken
3. Lead entra: Meta POST {entry:[{changes:[{value:{leadgen_id, form_id, page_id, created_time}}]}]}
   - Validar firma X-Hub-Signature-256 (HMAC con appSecret) — rechazar 401 si no cuadra
   - Responder 200 INMEDIATO (Meta reintenta si >20s); procesar async
4. Fetch detalle: GET graph.facebook.com/v21.0/{leadgen_id}?fields=field_data,created_time,ad_id,
   adset_id,campaign_id,ad_name,adset_name,campaign_name&access_token={pageAccessToken}
5. Map: field_data[] → fieldMap → payload captureLead + AdAttribution
   (campaignName/adName/adsetName/socialLeadId=leadgen_id)
6. captureLead → dedup → autoRoute → SlaTimer(5min) → workflow #1 (bot saluda)
7. connector_lead_log: PROCESSED (o DUPLICATE si dedup encontró contacto con deal activo)
```

### H.4 Protocolo TikTok Lead Generation

TikTok Business API (Marketing API → Lead Generation). Sin webhook confiable en todos los tiers →
**estrategia dual**:
- **Pull (MVP):** cron cada 5 min → `GET /open_api/v1.3/pages/leads/` o `lead/task` por advertiser_id
  con `lead_create_time` > lastSyncAt. Cada lead → mismo pipeline que Meta (pasos 5-7).
- **Webhook (si el tier lo permite):** `POST /api/connectors/tiktok/webhook` con validación de firma
  (TikTok-Signature, HMAC-SHA256 con secret). Mismo handler downstream.
- `leadSource`: se agrega valor **`TIKTOK_ADS`** al enum `LeadSource` (migración additiva).

### H.5 Webhook web unificado (formaliza el existente)

`POST /api/webhooks/leads` (ya existe vía Zapier; se versiona el contrato):
```jsonc
{ "source": "WEBSITE",            // LeadSource
  "firstName": "...", "lastName": "...", "phone": "+52...", "email": "...",
  "language": "ES",               // PreferredLanguage
  "hubDevelopmentId": "...",      // desarrollo de interés (opcional)
  "utm": { "source":"...", "medium":"...", "campaign":"...", "term":"...", "content":"..." },
  "gclid": "...", "fbclid": "...",
  "landingPage": "https://propyte.com/...", "message": "..." }
```
Auth: header `X-Webhook-Secret` (por conector WEBSITE). Respuesta: `{contactId, isNew, assignedTo}`.

### H.6 Funciones del subsistema
- **processIncomingLead(connectorId, externalLeadId, rawPayload)** — *webhook/cron* · idempotente por
  log UNIQUE → map → `captureLead` → log PROCESSED · emite `lead.captured` con `payload.connector`.
- **testConnector(connectorId)** — *admin* · valida credenciales (GET page / advertiser info) → status.
- **replayLead(logId)** — *admin* · re-procesa un log en ERROR.
- **pullTikTokLeads()** — *cron 5 min* · por cada conector TIKTOK ACTIVE → fetch → processIncomingLead.

### H.7 UI — `/admin` tab "Integraciones" → sección Conectores
- Tabla: nombre, proveedor (badge), status (ACTIVE verde/PAUSED neutro/ERROR rojo), último lead,
  leads 7d, errores. Acciones: probar, pausar/activar, editar, ver log.
- Form alta/edición: proveedor → campos de credenciales específicos + fieldMap editor (clave→campo).
- Vista log: tabla connector_lead_logs con filtro por status + botón replay en ERROR.

### H.8 Invariantes
- Webhook SIEMPRE responde <5s (procesamiento async vía cola del motor §D).
- Credenciales nunca en logs ni en respuestas de API (redact).
- Conector en ERROR ≥5 consecutivos → notificación a Dirección (workflow NOTIFY).
- Lead sin teléfono NI email → se registra log ERROR (no se crea contacto fantasma).

---

## I. INBOX WHATSAPP — CHATBOT CON TAKEOVER HUMANO

### I.0 Principio
Un solo hilo por contacto+canal. El bot (Claude, voz Sage, guardarraíles §6.0/§D.6) atiende en L2
hasta que: (a) el asesor **toma el control**, (b) hay **intención fuerte**, o (c) el contacto pide humano.
Todo queda en `Message` (timeline unificada P4). El asesor puede **devolver el control** al bot.

### I.1 `conversations` — NUEVA entidad

| Campo | Tipo | Req | Default | Notas |
|---|---|---|---|---|
| id | uuid | sí | uuid() | PK |
| contactId | uuid FK | sí | — | `@@unique([contactId, channel])` — un hilo por canal |
| channel | ConversationChannel | sí | WHATSAPP | `WHATSAPP` / `SMS` / `WEB` |
| status | ConversationStatus | sí | BOT | `BOT` / `HUMAN` / `SNOOZED` / `CLOSED` |
| controlledById | uuid? FK→User | no | — | asesor que tomó control (status=HUMAN) |
| botEnabled | Boolean | sí | true | kill-switch por conversación |
| lastMessageAt | DateTime? | no | — | orden del inbox |
| lastInboundAt | DateTime? | no | — | para SLA de respuesta |
| unreadCount | Int | sí | 0 | mensajes inbound no leídos por humano |
| aiSummary | String? @db.Text | no | — | resumen Claude del hilo (se regenera al takeover) |
| takeoverAt | DateTime? | no | — | timestamp del último takeover |
| createdAt/updatedAt | DateTime | — | — | |

### I.2 Extensiones a `messages` (entidad ACTUAL)

| Campo nuevo | Tipo | Notas |
|---|---|---|
| conversationId | uuid? FK | → conversations (nullable para histórico pre-migración) |
| sender | MessageSender | `CONTACT` / `ADVISOR` / `BOT` / `SYSTEM` |
| aiGenerated | Boolean @default(false) | |
| aiAutonomy | AutonomyLevel? | `L0` / `L1` / `L2` (nivel con el que se envió) |
| internalNote | Boolean @default(false) | notas internas del asesor — NO se envían al contacto |

### I.3 Flujo inbound (Twilio WhatsApp webhook → ya existe `api/twilio`)

```
1. Twilio POST /api/twilio/incoming {From, Body, MessageSid, ProfileName}
2. normalizePhone(From) → buscar Contact por phone
   - No existe → captureLead(source=WHATSAPP) → ruteo + SLA (workflow #1)
3. find/create Conversation(contactId, WHATSAPP)
4. Message{direction:INBOUND, sender:CONTACT} + conversation.lastInboundAt/unreadCount++
5. emitEvent('whatsapp.replied') → cierra SlaTimer FIRST_TOUCH si estaba RUNNING (el contacto respondió)
6. SI conversation.status=BOT y botEnabled y !contact.whatsappOptOut:
   → botRespond(conversationId) [§I.4]
   SI status=HUMAN → notificar a controlledBy (push/web) y NO responder automático
7. Detección de opt-out: Body ∈ {"BAJA","STOP","ALTO","UNSUBSCRIBE"} → optOut() + confirmación única
```

### I.4 `botRespond` — pipeline del bot (L2 con red)

```
1. Contexto: últimos 20 Message del hilo + Contact (perfil, idioma, score) + Deal activo (etapa)
2. RAG catálogo: si pregunta por desarrollos/precios/unidades → query proyección del Hub
   (data-gate: SOLO cifras con fuente del Hub; sin dato → "lo confirmo con tu asesor")
3. Claude (system prompt voz Sage + brand linter pre-envío):
   - intents que escalan a HUMANO: quiere apartar/visitar YA, negocia precio, queja/enojo,
     pregunta legal/fiscal, 2 respuestas seguidas de baja confianza
4. Si escala → conversation.status=HUMAN (controlledBy=assignedTo del contacto) + aiSummary
   + NOTIFY asesor ("el bot te pasó a Juan: quiere agendar visita mañana")
5. Si responde → Message{sender:BOT, aiGenerated:true, aiAutonomy:L2} vía Twilio
6. Side-effects: updateProfile (si capturó presupuesto/zona/timeline), scoreContact por evento
```

### I.5 Takeover / devolución

- **POST `/api/conversations/:id/takeover`** — *asesor* → `status=HUMAN`, `controlledById=session.user`,
  `takeoverAt=now()`, regenera `aiSummary` (para que el asesor retome en segundos) ·
  `Activity(tipo WHATSAPP_TAKEOVER)` · el bot queda mudo en ese hilo.
- **POST `/api/conversations/:id/release`** — *asesor* → `status=BOT` · el bot recibe el resumen
  del tramo humano como contexto. Guard: si `whatsappOptOut`, no se reactiva bot.
- **POST `/api/conversations/:id/close`** / **snooze** {until} — cierra o pospone (sale del inbox activo).
- Permisos: el asesor asignado, su TEAM_LEADER, GERENTE/DIRECTOR/ADMIN.

### I.6 UI — `/inbox` (estilo WhatsApp Web, 3 paneles, diseño B/N minimalista)

```
┌──────────────┬──────────────────────────────┬─────────────────┐
│ Conversación │  Hilo                        │ Contexto        │
│ es (lista)   │  burbujas: contacto izq /    │ contacto: score,│
│ filtros:     │  bot+asesor der; banda       │ temp, perfil    │
│ Mías·Bot·    │  superior: [BOT ACTIVO] o    │ deal: etapa     │
│ Sin asignar· │  [CONTROLAS TÚ] + botón      │ matching: 3     │
│ No leídas    │  Tomar control/Devolver bot  │ unidades Hub    │
│ buscador     │  composer: texto, plantillas │ acciones: crear │
│              │  (/atajo), nota interna ⊘,   │ deal, agendar,  │
│              │  adjuntos                    │ opt-out         │
└──────────────┴──────────────────────────────┴─────────────────┘
```
- Mensajes del bot con marca "🤖 Bot" sutil; notas internas con fondo distinto (no enviadas).
- Tiempo real: **MVP polling 5 s** sobre `/api/conversations?since=`; v2 SSE.
- Color: SOLO badges de estado (BOT neutro, HUMAN negro, score/temperatura con su semántica).

### I.7 Invariantes
- `status=HUMAN` ⇒ el bot NUNCA envía en ese hilo (ni por action plan; las acciones SEND_WHATSAPP
  de cadencias se saltan con log si la conversación está en HUMAN y el step es L2).
- `whatsappOptOut` ⇒ ni bot ni cadencias; solo respuesta manual del asesor (1:1 permitido por ley).
- Todo mensaje (bot/humano/cadencia) vive en `Message` → timeline única del contacto (P4).
- El takeover NUNCA pierde mensajes: lock optimista por `updatedAt` en el cambio de status.

---

## J. PERFILES DE USUARIO (correo, tarjeta, plantillas, cadencias)

### J.0 Principio
`User` queda para identidad/RBAC (no se toca). Lo configurable por persona vive en `user_profiles`
(1:1) + `user_templates` (1:N) + cadencias propias (ActionPlan con `ownerUserId`). Cada usuario
edita lo suyo en `/settings/profile`; ADMIN/Dirección editan a cualquiera desde `/admin`.

### J.1 `user_profiles` — NUEVA entidad (1:1 User)

| Campo | Tipo | Req | Default | Notas |
|---|---|---|---|---|
| id | uuid | sí | uuid() | PK |
| userId | uuid @unique FK | sí | — | |
| jobTitle | String? | no | — | "Asesor Senior", "Directora Comercial" |
| bioEs / bioEn | String? @db.Text | no | — | para tarjeta digital |
| photoUrl | String? | no | — | bucket Supabase `user-avatars` (compresión client-side) |
| phoneDirect | String? | no | — | E.164 |
| whatsappNumber | String? | no | — | E.164; CTA de la tarjeta |
| languages | String[] | sí | ["ES"] | idiomas que atiende (alimenta RoutingRule) |
| emailFromAlias | String? | no | — | ej. `felipe@propyte.com`; envío SMTP central con From alias |
| emailSignatureHtml | String? @db.Text | no | — | firma HTML; editor en settings |
| socialLinks | Json | sí | {} | `{instagram, linkedin, facebook, tiktok}` |
| cardSlug | String? @unique | no | — | tarjeta digital pública `/t/{slug}` |
| cardTheme | Json | sí | {} | `{accent?: "stage-color", layout: "minimal"}` — B/N por default |
| calendarUrl | String? | no | — | link de agenda (Google Appointment / Calendly) |
| defaultCadenceId | uuid? FK→ActionPlan | no | — | cadencia que se auto-aplica a sus leads nuevos |
| notificationPrefs | Json | sí | {} | por evento: `{lead_assigned:{push,email}, sla_breach:{...}}` |
| workingHours | Json | sí | {} | por día `{mon:{start:"09:00",end:"18:00"},...}` — gobierna dialer/SLA |
| createdAt/updatedAt | DateTime | — | — | |

### J.2 `user_templates` — NUEVA entidad (plantillas personales y de marca)

| Campo | Tipo | Req | Notas |
|---|---|---|---|
| id | uuid | sí | PK |
| userId | uuid? FK | no | **null = plantilla GLOBAL de marca** (solo ADMIN/MARKETING editan) |
| channel | TemplateChannel | sí | `WHATSAPP` / `EMAIL` / `SMS` |
| name | String | sí | "Primer contacto EN", "Precio Nativa" |
| shortcut | String? | no | atajo en composer: `/precio` — `@@unique([userId, shortcut])` |
| subject | String? | no | solo EMAIL |
| body | String @db.Text | sí | variables: `{{contact.firstName}} {{user.name}} {{development.name}} {{unit.price}} {{card.url}}` |
| language | PreferredLanguage | sí | ES/EN |
| isActive | Boolean @default(true) | sí | |
| usageCount | Int @default(0) | sí | ranking en el composer |
| createdAt/updatedAt/deletedAt | — | — | convenciones §A |

**Render de variables:** resolver server-side contra Contact/Deal/User/Hub al momento de enviar;
variable sin valor → se elimina la línea (nunca enviar `{{...}}` crudo). Plantillas pasan por el
**brand linter** al guardar (frases prohibidas → warning, no bloqueo, porque las escribe un humano).

### J.3 Cadencias por usuario

- Una cadencia ES un `ActionPlan` (§D.2) con campo nuevo **`ownerUserId uuid?`**:
  - `null` → cadencia global (los 8 workflows canónicos §D.5).
  - con valor → cadencia personal; solo visible/editable por su dueño (+ Dirección).
- `user_profiles.defaultCadenceId` → al asignarle un lead (`lead.assigned`), si el asesor tiene
  cadencia default y el lead no está enrolado en otro plan del mismo tipo → `enrollInPlan` automático.
- Steps de cadencia personal pueden referenciar `user_templates` propias (`config.templateId`).
- UI `/settings/cadences`: lista + builder secuencial (paso = día offset + canal + plantilla + autonomía).

### J.4 Tarjeta de presentación digital — page pública `/t/[cardSlug]`

- SSR pública (sin auth), diseño **minimalista B/N Propyte**: foto, nombre, puesto, bio (ES/EN switch),
  botones: **WhatsApp** (wa.me con mensaje pre-llenado), llamar, email, agenda (calendarUrl), social.
- **vCard download** (.vcf generado server-side) + **QR** (SVG server-side, sin servicio externo)
  que apunta a la URL de la tarjeta — para imprimir en tarjetas físicas.
- OG tags por usuario (foto+nombre) para compartir bonito en WhatsApp.
- Leads que tocan "WhatsApp" desde la tarjeta llegan al inbox con `leadSourceDetail="tarjeta:{slug}"`.

### J.5 UI — `/settings` (cada usuario) y `/admin` (gestión)

`/settings/profile` con tabs:
1. **Perfil** — foto, puesto, bio ES/EN, teléfonos, idiomas, social, agenda.
2. **Correo** — From alias, firma HTML (editor con preview), test de envío.
3. **Tarjeta** — slug, preview en vivo, QR descargable, vCard.
4. **Plantillas** — CRUD por canal con atajos y variables (picker de variables).
5. **Cadencias** — sus ActionPlans + default para leads nuevos.
6. **Notificaciones** — matriz evento × canal (push/email/WhatsApp interno).

`/admin` (tab Usuarios ya existente): botón "Perfil" por fila → edita el perfil de cualquiera;
plantillas globales de marca en tab nueva "Plantillas".

### J.6 Invariantes
- `cardSlug` único, kebab-case, inmutable tras 1ª publicación (los QR impresos no se rompen).
- `emailFromAlias` debe ser del dominio propyte.com (validación) — el envío real sale del SMTP
  central (Hostinger/nodemailer) con `From: "Nombre" <alias>`, `Reply-To` al alias.
- Plantilla global no es editable por asesores (RBAC); sí clonable a personal.
- Variables se resuelven con data-gate: `{{unit.price}}` SOLO desde proyección del Hub.

---

## K. DECISIONES TOMADAS (cierra OQs del Anexo Técnico §G)

| OQ | Decisión | Razón |
|---|---|---|
| G.1 AdAttribution | **Tabla propia en CRM** (1:1 Contact), poblada por los conectores (H) y el webhook web. El Hub conserva su pipeline de reporting sin cambios. Export offline a Google Ads = fase posterior, el campo queda. | El intake en vivo trae la atribución en el payload; proyectarla después desde el Hub sería más complejo. |
| G.2 Cache catálogo | **Proyección read-only con invalidación por webhook** + TTL 15 min de respaldo. Mientras no exista la API del Hub (T5.1), lectura SQL directa al esquema `real_estate_hub` detrás de una interfaz `HubCatalog` (swap limpio a API después). | Sala de ventas necesita <100ms; la interfaz aísla la migración. |
| G.3 TTL hold | **Configurable por desarrollo** (campo en Hub), default **72h**. | Preventa temprana puede querer 24h. |
| G.4 Cifrado KYC | **A nivel app** (AES-256-GCM, llave en env `KYC_ENCRYPTION_KEY`, helper `lib/crypto.ts`). | No depende de extensiones de BD; la llave nunca está en la BD. |
| G.5 Runner | **pg-backed queue (tabla `action_queue`) + cron Hostinger cada minuto + API route runner.** Sin servicios externos. | Consistente con stack; Upstash/BullMQ quedó vetado por patrón Felipe. |
| G.6 Merge | **Siempre con confirmación humana** (cola de candidatos en UI); auto-merge SOLO si teléfono Y email idénticos. | Memoria `feedback_humano_en_loop_obligatorio` + riesgo teléfono compartido. |
| G.7 businessHours | **Por plaza** en `sla_policies.businessHours` (jsonb keyed por plaza), una política default. | Tulum/PDC difieren ya hoy. |

*Fin — Anexo B v1.0.*
