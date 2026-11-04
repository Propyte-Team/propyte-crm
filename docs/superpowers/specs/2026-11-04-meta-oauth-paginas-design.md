# Conectar Meta (Lead Ads, Instagram, Messenger) con «Conectar con Facebook»

Tarjeta 982 · 2026-11-04 · Estado: **borrador; decisiones 1 y 2 tomadas (ver §6)**

## 1. Problema

Para conectar una Página de Facebook hoy hay que copiar y pegar datos técnicos:

| Canal | Qué pide hoy | Qué hace falta a mano en Meta |
|---|---|---|
| Lead Ads (`META`) | `pageId`, Page Access Token con `leads_retrieval`, `appSecret`, `verifyToken` (`registry.ts:32-44`) | Pegar la URL y el verify token del webhook, y suscribir la Página a `leadgen` (el CRM no lo hace: `subscribe/route.ts:30` solo acepta IG/Messenger) |
| Messenger / Instagram | `pageId`, token de system user con `pages_messaging`, `instagram_manage_messages`, `pages_manage_metadata`, `appSecret` (`meta-dms-wizard.tsx:41,51`) | Crear el system user y generar su token en Business Manager |

WhatsApp ya se conecta con un botón (Embedded Signup, `whatsapp-coex-connect.tsx`): login en un popup, el servidor canjea el código y suscribe la cuenta. La meta es lo mismo para las Páginas.

## 2. Resultado esperado (lo que ve el usuario)

1. En **Conexiones**, botón **«Conectar con Facebook»**.
2. Popup de Facebook: elige el negocio, las Páginas y la cuenta de Instagram que da al CRM, y acepta los permisos.
3. De regreso, una lista de las Páginas autorizadas. Por cada una, casillas: **Formularios de anuncios**, **Mensajes de Messenger**, **Mensajes de Instagram** (esta solo si la Página tiene Instagram profesional vinculado), y marca a la que pertenece.
4. **«Conectar»**: el CRM crea las conexiones, suscribe la Página a los eventos y deja cada una en «Funciona» (o «Con errores» con el motivo en español).
5. Para Lead Ads, paso opcional: elegir qué formularios entran (hoy `config.formIds` se llena a mano).

Nadie ve ni copia tokens, app secret ni verify token.

## 3. Diseño técnico

### 3.1 Configuración en Meta (la hace Luis, una vez)

- En la app 1718579335943082, **Facebook Login for Business → Configuraciones → nueva configuración** distinta de la de WhatsApp (la guía de WhatsApp pide no mezclar Páginas en su configuración, `docs/whatsapp-coexistencia-meta-setup.md` §3).
  - Tipo de token: **token de usuario del sistema (system-user access token)**, sin caducidad.
  - Activos: Páginas e Instagram.
  - Permisos: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_messaging`, `instagram_basic`, `instagram_manage_messages`, `leads_retrieval`, `pages_manage_ads` (para listar formularios), `business_management`.
- Nueva variable: `NEXT_PUBLIC_META_PAGES_CONFIG_ID`. `NEXT_PUBLIC_META_APP_ID` ya existe.
- Secreto de la app: las conexiones nuevas salen de la app de `NEXT_PUBLIC_META_APP_ID` y usan su secreto (`META_WA_APP_SECRET`, que pasa a llamarse `META_APP_SECRET` con respaldo al nombre viejo). El webhook de mensajes acepta la firma de `META_DM_APP_SECRET` **o** de `META_APP_SECRET`, así sirve tanto para conexiones viejas como nuevas sin tener que confirmar si son la misma app.
- Medido el 2026-11-04 (solo lectura, comparando huellas, sin ver valores): el `appSecret` guardado en las 10 conexiones de IG/Messenger tiene 3 valores distintos y **no se usa** (el webhook valida con el global). Llegan mensajes tanto de conexiones con un valor como con otro, así que ese campo no dice de qué app es cada conexión. Con OAuth deja de pedirse.

### 3.2 Flujo

Reutiliza el patrón de WhatsApp (popup + code flow, sin redirect):

1. **Cliente** (`src/components/conexiones/facebook-pages-connect.tsx`, nuevo): carga el SDK con el mismo cargador que WhatsApp (extraerlo a `src/lib/meta/sdk-loader.ts`) y llama `FB.login(cb, { config_id, response_type: "code", override_default_response_type: true })`.
2. **Servidor** `POST /api/admin/connectors/meta-oauth/canjear` (roles como `whatsapp-coex`): canjea el `code` con `GET /oauth/access_token` (`v24.0`), guarda el token de negocio en una **sesión de alta de corta vida** (fila cifrada, 15 min) y devuelve las Páginas: `GET /me/accounts?fields=id,name,access_token,instagram_business_account{id,username},tasks`. Al navegador solo van id, nombre e Instagram; nunca tokens.
3. **Servidor** `POST /api/admin/connectors/meta-oauth/conectar` con `{ sesionId, paginas: [{ pageId, leadAds, messenger, instagram, brandId }] }`:
   - Por Página: Page Access Token derivado del token de negocio (no caduca si el de origen no caduca).
   - Crea/actualiza `LeadConnector` META / MESSENGER / INSTAGRAM con las mismas formas de `config` y `credentials` que hoy (`pageId`, `igBusinessId`, `pageAccessToken` cifrado con `writeCredentials`), más `config.onboarding: "oauth"` y `config.metaBusinessId`. Así el webhook, la resolución de cuentas (`social-accounts.ts`) y el envío no cambian.
   - Suscribe la Página con `ensurePageSubscription` agregando `leadgen` a los campos cuando se pidió Lead Ads (`webhook-subscription.ts:91` hoy no lo incluye).
   - Corre «Probar» (`probarConector`) y deja el estado.
   - `AuditLog` como en `onboard.ts`.
   - Borra la sesión de alta.
4. **Formularios** (opcional): `GET /{page}/leadgen_forms?fields=id,name,status` para elegir; guarda `config.formIds`.

### 3.3 Webhooks

- **Lead Ads** (`/api/connectors/meta/webhook`): para conectores `onboarding: "oauth"`, verificación y firma con el `verifyToken`/`META_APP_SECRET` globales; los conectores manuales siguen con sus valores por conector. Pasar la llamada de detalle del lead de `v21.0` con token en la URL a `v24.0` con cabecera `Authorization`.
- **Messenger / Instagram** (`/api/webhooks/meta-dm`): sin cambios (ya usan valores globales).
- La URL de webhook y el verify token se configuran **una vez a nivel de app** en Meta (no por Página): con OAuth ya no se muestran al usuario.

### 3.4 Desconectar

Botón «Desconectar» en conexiones `oauth`: `DELETE /{page}/subscribed_apps` (solo si no queda otra conexión activa de esa Página), luego el borrado lógico actual. Hoy no se avisa a Meta (`[id]/route.ts:74-96`).

### 3.5 Salud del token

Cron diario con `GET /debug_token`: si el token ya no es válido o perdió permisos, la conexión pasa a «Con errores» con «Vuelve a conectar con Facebook». Reutiliza `traducirErrorConexion` (#190).

### 3.6 Convivencia con lo actual

- Las conexiones manuales siguen funcionando igual. En cada una aparece «Reconectar con Facebook», que la convierte en `oauth` conservando su id (mensajes, reglas y fuentes no se mueven).
- El asistente manual queda detrás de «Avanzado» hasta que todas estén migradas; luego se retira.
- Sin cambios de esquema salvo la sesión de alta (o SystemConfig con TTL si se prefiere no migrar).

## 4. Revisión de Meta: no hace falta para empezar

**Decisión (Luis, 2026-11-04):** conecta solo el equipo de Propyte, con las Páginas de Propyte y las que Propyte administra para sus clientes (Market, Nativa, Yaxnah, AVICA…).

- Con acceso estándar, los permisos funcionan para **personas con rol en la app** (administrador, desarrollador o tester). Quien pulse «Conectar con Facebook» debe tener ese rol y ser administrador (o tener la tarea de gestionar) de cada Página que elija. El popup solo muestra las Páginas a las que esa persona ya tiene acceso.
- Las Páginas de clientes deben estar compartidas con el negocio de Propyte en Business Manager (como socio) o administradas por la persona que conecta. Si el token es de usuario del sistema, la Página debe estar asignada a ese negocio: es el caso normal de «las que administramos».
- App Review (acceso avanzado) solo haría falta si alguien sin rol en la app tuviera que conectar sus propias Páginas. Fuera de alcance; F4 queda descartada.

## 5. Entregas

| # | Qué | Depende de |
|---|---|---|
| F0 | Configuración FLfB y variable `NEXT_PUBLIC_META_PAGES_CONFIG_ID` (Luis) | — |
| F1 | Cargador de SDK compartido, canje, lista de Páginas, alta de Messenger/IG por OAuth | F0 |
| F2 | Lead Ads por OAuth: suscripción `leadgen`, selector de formularios, webhook con secreto global y Graph `v24.0` | F1 |
| F3 | Reconectar conexiones manuales, desconectar con aviso a Meta, cron de salud | F2 |

Cada entrega: tests de las rutas con Graph simulado; verificación en navegador con una Página de prueba de Propyte.

## 6. Decisiones

1. **Quién conecta — decidido:** el equipo de Propyte, con sus Páginas y las de clientes que administra. Sin App Review (§4).
2. **Secreto de app — resuelto en el diseño:** el webhook acepta el secreto viejo o el nuevo (§3.1); no hace falta confirmarlo.
3. **Conexiones manuales — propuesta por defecto:** migrar con «Reconectar con Facebook», una por una, sin perder historial.
4. **Formularios de Lead Ads — propuesta por defecto:** entran todos; al conectar se puede limitar a algunos.

Si Luis no dice otra cosa, 3 y 4 quedan así.

## 7. Hallazgos al medir (fuera de este spec)

- En los últimos 7 días no entró ningún mensaje por «Messenger | DM Propyte - Market», «Messenger | DM Avica» ni «IG - AVICA» (las dos primeras nunca han recibido uno). Puede ser poco tráfico o una suscripción caída: revisar con el diagnóstico de conexiones (`/api/admin/connectors/health?probe=1`).
- El asistente de IG/Messenger sigue pidiendo un `appSecret` que no se usa (mismo caso que el verify token quitado en #250).
