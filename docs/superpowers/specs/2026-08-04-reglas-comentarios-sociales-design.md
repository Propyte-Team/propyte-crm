# Reglas de comentarios sociales (Instagram + Facebook)

Fecha: 2026-08-04
Estado: aprobado por Luis
Repo: `propyte-crm`
Rama: `feat/comment-rules-social`

## Problema

El bot del CRM solo atiende **mensajes directos**. `ConversationChannel` es
`WHATSAPP | SMS | WEB | INSTAGRAM | MESSENGER`, y el webhook social
`/api/webhooks/meta-dm` está suscrito **únicamente al campo `messages`**: lee
`entry[].messaging` vía `parseInstagramWebhook` / `parseMessengerWebhook` y para
cualquier otra forma de payload devuelve `messages = []` y responde `ok: true`
(`route.ts:72-77`).

Los comentarios de publicaciones llegan en `entry[].changes` (campo `feed` en
Facebook, `comments` en Instagram). Hoy nadie los escucha: el CRM los ignora en
silencio.

El patrón que Luis quiere es el clásico de campaña: alguien comenta una palabra
clave en el post ("info", "precios", "quiero"), el sistema responde en público y
además le abre el privado. ManyChat lo hacía y **ya está apagado**, así que hoy
esos comentarios no reciben nada.

No existe tampoco ningún disparador por palabra clave en el CRM: `bot-respond`
manda el mensaje completo a Claude y no hay tabla de reglas texto→acción.

## Restricción que condiciona el diseño

Meta permite **una sola callback URL por objeto y por app**. Los objetos `page` e
`instagram` de la app *CRM Propyte* ya apuntan a `/api/webhooks/meta-dm`. Al
suscribir `feed` y `comments`, esos payloads llegan **al mismo endpoint**.

No se crea un endpoint nuevo: se bifurca el que existe por la forma del payload.

## Alcance

Reglas configurables desde el CRM que, ante un comentario en Instagram o Facebook:

1. Responden **en público** con un texto fijo (variantes rotativas).
2. Mandan un **DM privado** con un opener fijo, y de ahí el bot Sage sigue la
   conversación en el Inbox con las reglas de escalación actuales.

Decisiones tomadas por Luis (2026-08-04):

| Tema | Decisión |
|---|---|
| Contenido | Público fijo + DM del bot: opener fijo, luego bot |
| Alcance de la regla | Toda la cuenta, con filtro opcional por publicación |
| Handoff | La conversación nace en `BOT` y escala como hoy |
| Contacto | Se crea **cuando responde el DM**, no al comentar |
| Match | Palabra completa, sin acentos ni mayúsculas |
| Moderación | Nada: el comentario queda visible |
| Límite | 1 vez por persona por publicación + variantes rotativas |
| Sin match | No se escribe nada; el log solo registra lo que dispara |

### Fuera de alcance (deliberado)

Bandeja completa de comentarios, ocultar o borrar comentarios, respuestas
públicas escritas por IA, reglas por horario, TikTok y YouTube, comentarios de
Live, menciones en stories.

## Arquitectura

```
Meta (objeto page/instagram)
        │
        ▼
/api/webhooks/meta-dm            ← firma y verify token compartidos
        │
        ├── entry[].messaging ──────────────► camino DM actual (intacto)
        │                                     handleInboundMessage → botRespond
        │
        └── entry[].changes (feed|comments) ► lib/comments/handle-comment.ts
                                                  │
                                    ┌─────────────┼──────────────┐
                                    ▼             ▼              ▼
                              match.ts      respuesta        DM privado
                              (pura)        pública          (recipient:
                                            Graph            comment_id)
                                                  │
                                                  ▼
                                          CommentRuleLog
                                                  │
                              (la persona responde el DM)
                                                  ▼
                                    handleInboundMessage crea el Contact
                                                  ▼
                                        linkCommentOrigin()
```

Módulos nuevos, cada uno con una responsabilidad:

| Archivo | Qué hace | De qué depende |
|---|---|---|
| `src/lib/comments/match.ts` | Normaliza y decide qué regla gana | nada (pura) |
| `src/lib/comments/graph.ts` | Respuesta pública y private reply | `fetch` |
| `src/lib/comments/parse.ts` | Payload de Meta → `IncomingComment` | nada (pura) |
| `src/lib/comments/handle-comment.ts` | Orquesta: idempotencia, cuota, acciones, log | Prisma, los 3 de arriba |
| `src/lib/comments/link-comment-origin.ts` | Puente comentario → contacto | Prisma |
| `src/server/comment-rules.schema.ts` | Zod de alta/edición | zod |

## Modelo de datos

Migración **additiva**: 2 tablas, 2 enums. Nada existente cambia de tipo.

```prisma
model CommentRule {
  id            String   @id @default(uuid())
  name          String
  connectorId   String                        // LeadConnector: cuenta + token
  isActive      Boolean  @default(false)      // nace en pausa
  priority      Int      @default(100)        // menor gana
  phrases       String[]                      // se guardan ya normalizadas
  publicReplies String[]                      // variantes, máx 5
  dmTemplate    String   @db.Text
  postFilter    String[] @default([])         // vacío = toda la cuenta; IDs tal como los manda Meta

  connector LeadConnector    @relation(fields: [connectorId], references: [id])
  logs      CommentRuleLog[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@unique([connectorId, name])
  @@index([connectorId, isActive, priority])
  @@map("comment_rules")
  @@schema("propyte_crm")
}

model CommentRuleLog {
  id                 String              @id @default(uuid())
  ruleId             String?             // SetNull si se borra la regla
  connectorId        String
  platform           CommentPlatform
  externalCommentId  String              @unique
  postId             String
  authorId           String              // from.id (ASID en FB, IGSID en IG)
  authorHandle       String?
  commentText        String              @db.Text
  matchedPhrase      String              // solo se registra lo que hizo match
  publicReplyStatus  CommentActionStatus
  publicReplyError   String?
  publicReplyId      String?
  dmStatus           CommentActionStatus
  dmError            String?
  dmRecipientId      String?             // PSID/IGSID que devuelve la Send API
  dmExternalMessageId String?
  contactId          String?             // se llena al responder el DM

  rule    CommentRule? @relation(fields: [ruleId], references: [id], onDelete: SetNull)
  contact Contact?     @relation(fields: [contactId], references: [id])

  createdAt DateTime @default(now())

  @@index([connectorId, postId, authorId])   // cuota
  @@index([dmRecipientId])                   // puente al contacto
  @@index([ruleId, createdAt])               // log de la UI
  @@map("comment_rule_logs")
  @@schema("propyte_crm")
}

enum CommentPlatform { INSTAGRAM  FACEBOOK  @@schema("propyte_crm") }
enum CommentActionStatus { SENT  FAILED  SKIPPED  @@schema("propyte_crm") }
```

Relaciones inversas que hay que agregar a los modelos existentes (Prisma exige
los dos lados): `LeadConnector.commentRules CommentRule[]` y
`Contact.commentLogs CommentRuleLog[]`. Ninguna columna existente cambia.

`platform` se deriva del objeto del webhook (`instagram` → `INSTAGRAM`, `page` →
`FACEBOOK`) y no del `provider` del conector, que para Facebook es `MESSENGER`.
Es para que el log se lea en los términos de la plataforma, no del canal de DM.

`externalCommentId @unique` hace tres trabajos con un solo índice:

1. **Idempotencia** contra los reintentos del webhook de Meta.
2. **Libro de cuotas**: `(connectorId, postId, authorId)` responde "esta persona
   ya recibió respuesta en esta publicación".
3. **Contador de rotación** de variantes públicas.

No hace falta tabla extra de cuotas ni contador aparte.

## Matcher

`src/lib/comments/match.ts`, función pura, sin Prisma ni `fetch`.

```
normalize(s): minúsculas → NFD sin diacríticos → espacios colapsados
```

Match de **palabra completa** con lookbehind/lookahead de letra-o-dígito
(`(?<![\p{L}\p{N}])frase(?![\p{L}\p{N}])`, flag `u`), sobre la frase normalizada
y escapada.

Consecuencias buscadas:

- `info!!`, `Info 🙏`, `¿info?`, `info porfa` → **disparan** `info`
- `informal`, `información` → **no disparan** `info`
- Frases de varias palabras funcionan igual: `quiero info` es un match literal
  con límites en los extremos.

Selección de regla: reglas activas de esa cuenta ordenadas por `priority` asc y
luego `createdAt` asc; **la primera que coincide gana** y las demás no se
evalúan. Si la regla trae `postFilter` no vacío, solo aplica si `postId` está en
la lista.

## Ejecución

`handleComment(comment)` en `src/lib/comments/handle-comment.ts`:

1. **Resolver conector** con `resolveConnectorByIgBusinessId` /
   `resolveConnectorByPageId` (ya existen en `lib/messaging/social-accounts.ts`).
   Sin conector activo → warn y salir.
2. **Descartes** (sin escribir en el log):
   - comentario de la propia cuenta (`from.id` == `igBusinessId` / `pageId`) —
     anti-loop, evita que el sistema se responda solo;
   - `verb != "add"` (edición y borrado no disparan);
   - **respuestas anidadas** (`parent_id` presente): solo primer nivel, porque
     Instagram no acepta responder a una respuesta.
3. **Idempotencia**: si `externalCommentId` ya existe → salir.
4. **Match**. Sin match → salir sin escribir nada.
5. **Cuota**: si existe log previo con `(connectorId, postId, authorId)` →
   registrar `SKIPPED` en ambas acciones y salir.
6. **Crear el log** antes de llamar a Graph. El `@unique` es el candado contra
   reintentos concurrentes de Meta.
7. **Acciones independientes**, cada una en su try/catch: si la pública falla, el
   DM sale igual, y al revés. Cada una escribe estado y motivo en su columna.
   - Pública: IG `POST /{comment_id}/replies`, FB `POST /{comment_id}/comments`.
     Variante = `(disparos previos de la regla) % publicReplies.length`.
   - DM: `POST /me/messages` con `recipient: { comment_id }` — el único camino
     que Meta da para escribirle a alguien que solo comentó. Se guarda
     `recipient_id` y `message_id` de la respuesta.

`{{usuario}}` se sustituye en ambos textos con `from.username` (IG) o `from.name`
(FB), que vienen en el propio webhook: cero llamadas extra a Graph.

### Ventana de 7 días

El private reply solo es válido dentro de la ventana que impone Meta (7 días
desde el comentario) y una sola vez por comentario. Vencida, Graph devuelve
error: el log queda `FAILED` con el mensaje textual de Meta, no con un genérico.

## Puente comentario → contacto

El `recipient_id` que devuelve la Send API **es el PSID (Facebook) o IGSID
(Instagram)** de la persona. Con eso:

- **Si ya es contacto conocido** (`instagramId` / `messengerPsid` coincide): el
  opener se persiste como `Message` `OUTBOUND` `sender: BOT` en su conversación,
  con el `message_id` de la Send API, y la conversación **se queda en `BOT`**.

  Esto es obligatorio, no cosmético: sin ese paso, el eco de nuestro propio DM
  entra por `handleEchoMessage`, se registra como `ADVISOR` y **dispara el
  takeover suave que pone la conversación en `HUMAN` y enmudece al bot**
  (`core.ts:134-139`). Persistiéndolo nosotros, el eco choca con
  `Message.externalMessageId @unique` y se descarta solo.

- **Si no es contacto**: no se crea nada (decisión de Luis). El `dmRecipientId`
  queda en el log. Cuando la persona responda el DM, `handleInboundMessage` crea
  el contacto por el flujo normal de intake y entonces `linkCommentOrigin`:
  1. estampa `contactId` en el log,
  2. rellena el opener como mensaje `OUTBOUND` `sender: BOT` usando el
     `dmExternalMessageId` guardado (idempotente por el índice único), para que
     el asesor vea en el hilo qué se le dijo,
  3. registra la actividad "vino del comentario X en la publicación Y".

`linkCommentOrigin(contactId, channel, senderId)` se invoca desde `core.ts` como
side-effect en try/catch, igual que `meetSlaTimers` y la actividad: **nunca puede
matar la ingesta**.

## Interfaz — Admin → Comentarios

Tab nuevo (`/admin?tab=comments`), componente `comment-rules-tab.tsx`. Guard de
rol igual al del resto de `/admin`.

**Lista de reglas**: nombre, badge de cuenta (IG/FB), frases como chips, estado,
disparos de los últimos 30 días, último disparo. Pausar/activar, editar, borrar.
Mismo lenguaje visual que `connectors-section.tsx`.

**Diálogo de alta/edición**:

- **Nombre** y **Cuenta** (select de conectores `INSTAGRAM`/`MESSENGER` activos).
- **Frases**: input con chips, Enter agrega. Debajo se muestra la forma
  normalizada real que se va a comparar, y **avisa si la frase ya la usa otra
  regla de la misma cuenta** — ahí está el error silencioso: gana la de mayor
  prioridad y la otra nunca dispara sin que nada lo indique.
- **Respuestas públicas**: hasta 5 variantes, con contador de caracteres.
- **Mensaje privado (DM)**: textarea.
- Ambos textos aceptan `{{usuario}}`.
- **Publicaciones**: vacío = toda la cuenta. Acepta **IDs de publicación**, no
  URLs: la URL de un post de Instagram lleva un *shortcode*
  (`instagram.com/p/DAbC123`) que no es el `media_id`, y Graph no ofrece forma de
  convertirlo. Para que sea usable, el log trae botón de **copiar ID de la
  publicación** en cada fila, que es donde el ID aparece de forma natural en
  cuanto llega el primer comentario.
- **Prioridad**. La regla **nace en pausa**.

**Probador en seco**: se pega un comentario de ejemplo y responde qué regla gana,
con qué frase, qué variante pública saldría y el DM ya renderizado. Cero llamadas
a Meta: imposible publicar por accidente desde el probador.

**Log**: tabla paginada con fecha, cuenta, publicación (link al post y copiar ID),
autor, comentario, regla, estado público, estado DM, motivo del error y contacto
vinculado. Filtro por regla y estado. **Reintentar** en los fallidos.

## APIs

| Ruta | Método | Qué hace |
|---|---|---|
| `/api/admin/comment-rules` | GET, POST | listar, crear |
| `/api/admin/comment-rules/[id]` | PATCH, DELETE | editar, pausar, borrar (soft) |
| `/api/admin/comment-rules/logs` | GET | log con filtros y paginación |
| `/api/admin/comment-rules/logs/[id]/retry` | POST | reintentar acción fallida |
| `/api/admin/comment-rules/test` | POST | dry-run del matcher |

Validación con Zod en `src/server/comment-rules.schema.ts`, siguiendo el patrón
de `bot-config.schema.ts` (el esquema vive fuera del archivo `"use server"`).

## Manejo de errores

| Situación | Comportamiento |
|---|---|
| Firma inválida | 401, sin procesar (comportamiento actual del endpoint) |
| Sin conector activo para la cuenta | warn en consola, 200 a Meta, nada escrito |
| Comentario propio / anidado / `verb != add` | descarte silencioso |
| Sin match | nada escrito, 200 a Meta |
| Cuota consumida | log `SKIPPED` en ambas acciones |
| Falla la respuesta pública | `publicReplyStatus = FAILED` + motivo; el DM se intenta igual |
| Falla el DM | `dmStatus = FAILED` + motivo; la pública ya salió |
| Ventana de 7 días vencida | `dmStatus = FAILED` con el mensaje textual de Meta |
| Error de Prisma en el log | se propaga: el webhook responde 500 y Meta reintenta |

Al webhook siempre se le responde 200 salvo firma inválida o fallo de
persistencia. Un error de Graph no debe provocar reintentos de Meta, porque el
comentario ya quedó registrado y el reintento chocaría con la idempotencia.

Consecuencia asumida: una acción `FAILED` **no se reintenta sola**. Ese es el
motivo de que el botón *Reintentar* del log exista, y de que el motivo del error
se guarde textual y no como un genérico — es lo único con lo que Luis puede
decidir si vale la pena reintentar o si la ventana ya venció.

## Pruebas

TDD: primero el test que falla.

- `match.test.ts` — acentos y mayúsculas; `informal` e `información` **no**
  disparan `info`; frase de varias palabras; emoji y puntuación; prioridad;
  empate resuelto por antigüedad; `postFilter` respetado.
- `parse.test.ts` — payload real de `feed` (FB) y de `comments` (IG) → forma
  normalizada; `verb` de edición y borrado descartados; anidados detectados.
- `handle-comment.test.ts` (Graph inyectado como fake) — idempotencia por
  `externalCommentId`; cuota por persona+publicación; rotación de variantes;
  comentario propio ignorado; pública falla y el DM sale igual; ventana vencida →
  `FAILED` con el motivo de Meta.
- `route.test.ts` — `changes` de IG y de FB llegan al motor; `messaging` sigue por
  el camino DM (**regresión del inbox social**); firma inválida → 401.
- `link-comment-origin.test.ts` — estampa `contactId`; rellena el opener; es
  idempotente; **la conversación no cae en `HUMAN`**.

Gates antes de dar por terminado: `npm test`, `npx tsc --noEmit`, `npm run build`.

## Gate de infraestructura

La feature nace **dormida**: sin conector configurado y con las reglas en pausa,
el código no hace nada. Para encenderla, en la app *CRM Propyte* de Meta:

1. Suscribir el campo **`feed`** en el objeto `page` y **`comments`** en el
   objeto `instagram` (misma callback URL que ya está verificada).
2. Acceso Avanzado (App Review) a `pages_manage_engagement`,
   `pages_read_engagement`, `instagram_manage_comments`,
   `instagram_manage_messages`.
3. Aplicar la migración additiva en Supabase `oaijxdpevakashxshhvm` — la aplica
   Luis, no el agente (Supabase compartida).
4. Crear una regla de prueba en una publicación real y verificar el log.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El eco del propio DM enmudece al bot | Persistir el opener con el `message_id` de la Send API; test de regresión que verifica que la conversación sigue en `BOT` |
| Meta marca la página por respuestas idénticas | Variantes rotativas + 1 respuesta por persona por publicación |
| Dos reglas con la misma frase, una nunca dispara | Aviso de colisión en la UI al escribir la frase |
| Bifurcar el webhook rompe el inbox social | Test de regresión del camino `messaging` antes de tocar la ruta |
| App Review demora | La feature queda dormida sin bloquear nada más del CRM |
