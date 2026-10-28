# Meta App Review — solicitud de permisos de WhatsApp (oct 2026)

App: **Propyte CRM** (app ID 1718579335943082)

Permisos a pedir (acceso avanzado), **solo estos dos**:

- `whatsapp_business_management`
- `whatsapp_business_messaging`

**No incluir** `whatsapp_business_manage_events` (Meta lo rechazó en agosto porque exige tener antes
acceso avanzado a `whatsapp_business_messaging`; pedirlo en una ronda posterior) ni
`paid_marketing_messages` / Human Agent (sin caso de uso hoy).

Feature que los usa: **Conectar WhatsApp (oficial)** — WhatsApp en coexistencia con Embedded Signup v4
(tarjetas #879 marca y #880 asesor). Código ya en `main`: `src/lib/whatsapp/coex/`,
`src/components/conexiones/whatsapp-coex-connect.tsx`, `src/components/settings/mi-whatsapp.tsx`,
webhook `src/app/api/webhooks/whatsapp/meta/route.ts`. Configuración en Meta:
`docs/whatsapp-coexistencia-meta-setup.md`.

---

## Por qué se rechazó en agosto (4-ago-2026)

- `whatsapp_business_messaging`: *"the explanation of your app's use case was unclear"* y *"ensure that
  the screencast submitted is the correct video for your app"*. Caso de uso confuso + video equivocado.
- `whatsapp_business_manage_events`: dependía de tener acceso avanzado a `whatsapp_business_messaging`.
- `whatsapp_business_management`: **no se pidió**, y es el que necesita Embedded Signup.

Lo que el revisor exige en mensajería (notas de agosto a `pages_messaging` / `instagram_manage_messages`,
mismo criterio para WhatsApp): **(1)** el activo seleccionado y visible (el número), **(2)** un envío en vivo
desde la interfaz del CRM, **(3)** el mensaje entregado en el cliente nativo (WhatsApp en el teléfono).

Diferencia con el reenvío de comentarios: aquí **sí hay login de Meta** (Embedded Signup es Facebook Login
for Business), así que el video **muestra el flujo completo de Meta** y no hace falta la nota de System User.

---

## 0. Antes de grabar (checklist)

Todo esto tiene que estar listo para que el botón funcione con una cuenta que tenga rol en la app:

- [ ] Tech Provider: onboarding hecho y **negocio verificado** (setup §1).
- [ ] Facebook Login for Business: dominios y redirect URI de `crm.propyte.com` (setup §2).
- [ ] Configuración de Embedded Signup v4 creada → `config_id` (setup §3).
- [ ] Webhook fields suscritos: `messages`, `account_update`, `history`, `smb_app_state_sync`,
      `smb_message_echoes` (setup §4) — **antes** de conectar el primer número.
- [ ] En hPanel: `NEXT_PUBLIC_META_APP_ID` y `NEXT_PUBLIC_META_ES_CONFIG_ID` puestas y app reiniciada
      (no hace falta recompilar). En Conexiones el botón ya **no** debe decir «no disponible».
- [ ] La persona que graba tiene rol (admin/dev/tester) en la app de Meta.
- [ ] Número de prueba: WhatsApp **Business** en un teléfono (2.24.17+), con método de pago en su WABA.
      Sugerido: el de Yaxnáh (setup §7). Un segundo teléfono con WhatsApp normal para hacer de cliente.
- [ ] Usuario `meta-reviewer` en el CRM con acceso a **Conexiones** e **Inbox** (el mismo del reenvío de
      comentarios, si ya existe).
- [ ] Grabación: 1080p, cursor visible, navegador traducido a inglés (Chrome → Traducir a English),
      WhatsApp/Facebook con idioma en inglés si se puede, **subtítulos en inglés** y un callout por botón.
- [ ] **No mostrar** tokens, el App Secret ni la contraseña en pantalla.

---

## 1. Texto para "Tell us how you're using this permission"

### whatsapp_business_management

> Propyte is a real-estate company in Mexico. Propyte CRM is our internal CRM, used by our marketing team
> and our sales advisors. We are onboarding as an independent **Tech Provider** so that our own brands
> (e.g. Yaxnáh) and our sales advisors can connect the **WhatsApp Business app number they already use**
> to the CRM through **Embedded Signup (v4, WhatsApp Business app coexistence)**, without losing the app on
> their phone.
>
> **Which function needs it:** the "Connect WhatsApp (official)" button in **Connections → Meta →
> WhatsApp Cloud API** (for a brand) and **Settings → My WhatsApp** (for an advisor). After the user
> completes Embedded Signup, our server exchanges the returned code, reads the WhatsApp Business Account and
> phone number the user shared, **subscribes our app to that WABA** (`POST /{waba-id}/subscribed_apps`) and
> requests the contacts and chat-history sync for coexistence (`smb_app_data`). It also receives
> `account_update` webhooks so the CRM shows when a number is disconnected from the phone and alerts admins.
>
> **How it improves the app and the user experience:** without this permission the number has to be set
> up by hand by a developer with a token; with it, any brand or advisor connects their own number in one
> guided Meta window, keeps using WhatsApp on their phone, and their customer conversations appear in the
> CRM inbox next to Instagram and Messenger. We only access the WhatsApp accounts the user explicitly
> selects in Embedded Signup. For advisor numbers, only chats with existing CRM contacts are stored;
> personal chats are never saved.

### whatsapp_business_messaging

> Propyte CRM's **Inbox** lets our team answer prospects who write to our WhatsApp numbers about the homes we
> sell. We need `whatsapp_business_messaging` to **receive** incoming messages through the `messages`
> webhook and to **send** the replies our staff type in the CRM inbox (`POST /{phone-number-id}/messages`),
> including approved templates when the 24-hour window is closed.
>
> With coexistence, messages the business sends from the WhatsApp Business app on the phone also arrive
> (`smb_message_echoes`) so the conversation in the CRM is complete. Every message is stored on the
> contact's timeline, so any advisor who takes over the lead sees the full history.
>
> **How it improves the user experience:** the prospect gets a faster answer on WhatsApp, from the same
> number they already know, and does not have to repeat information when another advisor takes over. Our
> staff answer WhatsApp, Instagram and Messenger from one place. We do not send unsolicited marketing
> messages through this integration.

---

## 2. Guion de los videos

Meta pide **un video por permiso**. Caption en inglés en cada paso.

### Video 1 — `whatsapp_business_management` (Embedded Signup)

1. Login en `https://crm.propyte.com` con `meta-reviewer`. *Caption: "Propyte CRM — our internal CRM."*
2. **Conexiones → Meta → WhatsApp · Cloud API**, elegir la marca → pulsar **Conectar WhatsApp (oficial)**.
   *Caption: "Connect WhatsApp (official): starts Meta Embedded Signup."*
3. Se abre la ventana de Meta: **login con Facebook completo** (sin cortes), elegir el portafolio, elegir
   **conectar una cuenta de WhatsApp Business existente**, escribir el número, confirmar en el teléfono
   (QR o código) y aceptar compartir historial. *Caption: "The user selects their own WhatsApp Business
   number. The app only gets access to the accounts selected here."*
4. Volver al CRM: la cuenta aparece **Conectado / Sincronizando historial**, con el número visible.
   *Caption: "whatsapp_business_management: our server subscribes the app to this WABA and starts the
   coexistence sync."*
5. Plantilla (lo que la guía de Meta sugiere para este permiso): abrir **WhatsApp Manager** de esa WABA →
   **Message templates → Create template**, crear una plantilla de utilidad y enviarla. *Caption: "Message
   templates of the connected account, used to reply after the 24-hour window."*
6. (Opcional) En el teléfono: **Settings → Account → Business Platform** muestra el CRM conectado.

### Video 2 — `whatsapp_business_messaging` (enviar y recibir)

1. Mostrar el número conectado en Conexiones (activo visible). *Caption: "Connected number: +52 …"*
2. Desde el **teléfono del cliente** (WhatsApp normal) escribir al número: «Hi, I'd like info about
   Yaxnáh». *Caption: "A prospect writes to our WhatsApp number."*
3. CRM → **Inbox**: la conversación aparece con el mensaje. *Caption: "Incoming message received via the
   messages webhook."*
4. En el composer del CRM escribir y **enviar** una respuesta en vivo. *Caption: "Our advisor replies from
   the CRM."*
5. Volver al **teléfono del cliente**: la respuesta llegó desde el número de la marca. *Caption:
   "whatsapp_business_messaging: the message sent from the CRM is delivered in WhatsApp."*
6. (Coexistencia) Contestar desde el **teléfono de la marca** en WhatsApp Business → en el CRM aparece el
   mensaje en la misma conversación. *Caption: "Messages sent from the phone also appear in the CRM."*

---

## 3. Instrucciones para el revisor

> Propyte CRM is the internal CRM of Propyte, a real-estate company in Mexico. We are an independent Tech
> Provider for our own brands and sales advisors, who connect the WhatsApp Business app number they already
> use through Embedded Signup v4 (coexistence). The CRM interface is in Spanish; the screencasts were
> recorded with the browser translated to English and include English captions.
>
> **Login:** https://crm.propyte.com — credentials below (account created for Meta reviewers).
>
> **whatsapp_business_management:** Connections ("Conexiones") → Meta → WhatsApp Cloud API → "Conectar
> WhatsApp (oficial)". This launches Meta Embedded Signup; after it finishes, the number appears as
> connected. See video 1.
>
> **whatsapp_business_messaging:** send a WhatsApp message to <número de prueba>. It appears in the CRM
> Inbox; replies typed in the Inbox are delivered to your WhatsApp from that number. See video 2.

*(La credencial de `meta-reviewer` va en el campo de credenciales; no guardarla en este archivo.)*

---

## 4. Orden

1. Completar el checklist §0 y grabar ya (funciona con rol en la app, sin esperar la revisión).
2. Esperar a que termine la revisión en curso (comentarios + reenvío de permisos de Páginas/IG).
3. Enviar una solicitud nueva **solo** con los dos permisos de WhatsApp.
4. Al aprobarse: conectar el primer asesor desde **Ajustes → Mi WhatsApp** y cerrar #879/#880.
