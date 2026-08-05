# Marcar SPAM desde el Inbox — Diseño

**Fecha:** 2026-08-05
**Estado:** aprobado, pendiente de plan de implementación
**Relacionado:** `2026-08-04-reglas-comentarios-sociales-design.md`

## Problema

Desde el Inbox del CRM no hay forma de deshacerse de una conversación de spam. Hoy hay que
salir a Instagram o a Meta Business Suite para bloquear, y volver al CRM para borrar el
contacto a mano. Se quiere un solo gesto que haga las dos cosas.

## Qué permite Meta de verdad (verificado contra Graph v24 el 2026-08-05)

Esto condiciona todo el diseño, así que va primero.

**No existe ningún endpoint para denunciar/reportar** a una persona ni una conversación, ni en
Messenger ni en Instagram. Tampoco para reportar al autor de un comentario. Un botón
"Denunciar" sería mentira y no se va a construir.

Lo que sí existe y nuestra app puede usar hoy:

| Acción | Endpoint | Efecto |
|---|---|---|
| Bloquear en IG | `POST /{page-id}/moderate_conversations` con `{"user_ids":[{"id":"<IGSID>"}],"actions":["block_user"]}` | *"Blocks all interactions—user cannot message the business or access its profile, posts, or stories."* |
| Spam en IG | mismo endpoint, `actions:["move_to_spam"]` | Mueve la conversación a la carpeta de spam del Inbox de Meta Business Suite. **No es una denuncia a Meta.** |
| Desbloquear en IG | mismo endpoint, `actions:["unblock_user"]` | Reversible |
| Bloquear en Messenger | `POST /{page-id}/blocked` con `psid` (GET lista, DELETE desbloquea) | Bloqueo a nivel de Página |

Permisos requeridos por `moderate_conversations`: `instagram_manage_messages`,
`instagram_basic`, `business_management`, Advanced Access.

**Comprobado en producción el 2026-08-05:** `GET /834510929743516/blocked` → `200` (lista
vacía). `POST /834510929743516/moderate_conversations` con un ID falso → `400 (#100) The user
ID is not a valid PSID nor IGSID`, es decir rechaza el ID, **no el permiso** (si faltara la
capability sería `code 3`). La API está disponible para nosotros.

Límites documentados: máximo 10 IDs y 2 acciones por request; `block_user` y `unblock_user` no
pueden ir juntas; no se puede bloquear a alguien ligado al negocio por Accounts Center.

**Prerrequisito duro:** `moderate_conversations` exige que la conversación ya exista. Ver
"Errores" más abajo — tiene consecuencias reales para el spam que llega solo por comentario.

## Decisiones tomadas

1. **En Meta:** `block_user` + `move_to_spam` (IG) o `POST /blocked` (Messenger).
2. **El contacto:** soft delete + anonimización de PII. No hay borrado duro.
3. **Reentrada:** tabla propia `blocked_senders` consultada en el intake.
4. **Salvaguarda:** abortar si el contacto tiene deals o walk-ins.
5. **Roles:** los mismos que ya pueden borrar contactos.
6. **Orquestación:** CRM en transacción, Meta best-effort con estado guardado y reintentable.

### Por qué no hay borrado duro

Se consultaron las FK reales en Supabase (no el `.sql` del repo). **11 tablas bloquean el
borrado de un contacto**: 10 con `RESTRICT` — `activities`, `ad_attributions`,
`contact_dossiers`, `conversations`, `conversion_events`, `deals`, `messages`, `sla_timers`,
`walk_ins`, `web_behavior` — más `shortlists` con `NO ACTION`. Un `DELETE` del contacto **falla con
violación de FK** salvo que se borren antes todas las hijas en orden — y cualquier tabla nueva
que apunte a `contacts` en el futuro rompería la operación sin avisar.

`SET NULL` solo en `comment_rule_logs.contactId`, `connector_lead_logs.contactId` y
`units.reservedByContactId`. `CASCADE` solo en `gmail_threads`.

El soft delete además ya excluye al contacto de métricas y reportes sin escribir una línea:
verificado que `src/server/dashboard.ts` (leads nuevos del mes y del mes anterior) y
`src/server/reports.ts` (`contactWhere`) filtran `deletedAt: null`.

## Datos

Una sola tabla nueva. **La migración va a `prisma/migrations-manual/` y NO se aplica sin
autorización explícita del usuario** (la base es compartida con el Hub).

```
blocked_senders
  id               text  pk
  channel          MessageChannel        -- enum YA existente (WHATSAPP|SMS|INSTAGRAM|MESSENGER)
  identifier       text                  -- IGSID, PSID o teléfono
  reason           text  null
  blockedById      text  null  -> users(id)     ON DELETE SET NULL
  contactId        text  null  -> contacts(id)  ON DELETE SET NULL
  metaBlockStatus  CommentActionStatus   -- enum YA existente (PENDING|SENT|FAILED|SKIPPED)
  metaSpamStatus   CommentActionStatus
  metaError        text  null
  createdAt        timestamp
  unblockedAt      timestamp null

  unique (channel, identifier)
```

Único por `(channel, identifier)`: desbloquear y volver a bloquear **reutiliza la fila**
(`unblockedAt` vuelve a `NULL`) en vez de duplicarla. Así se evita un índice único parcial, que
Prisma no modela de forma nativa.

**Nada más cambia en el schema.** Para marcar el contacto se usan campos que ya existen —
`tags` (`String[]`, se le añade `"SPAM"`), `contactStatus: DESCARTADO` y `doNotContact: true` —
en lugar de añadir un valor `SPAM` al enum `ContactStatus`, para que la migración no toque
ningún tipo que el Hub pueda estar leyendo.

## Módulos

Tres piezas, una responsabilidad cada una, ninguna depende de las otras dos:

- **`src/lib/moderation/block-sender.ts`** — solo base de datos, sin red. La transacción
  completa. Entrada: `{conversationId, actorId, reason?}`. Salida: el registro de
  `blocked_senders` creado, o el motivo del rechazo.
- **`src/lib/moderation/meta-moderation.ts`** — solo Graph. `blockOnMeta({platform, connector,
  identifier})` → `{blockStatus, spamStatus, error?}`. Nunca lanza. `fetch` inyectable, igual
  que `decrypt` en `getSocialPageToken`, para testear sin tocar Meta.
- **`src/lib/moderation/is-blocked.ts`** — `isSenderBlocked(channel, identifier)`. Una sola
  consulta, `unblockedAt: null`.

El endpoint es una acción más en `POST /api/conversations/[id]/actions` (`mark_spam`),
reutilizando su esquema zod y su comprobación de sesión. No se crea ninguna ruta nueva para la
acción. **Pero no reutiliza el gate de permisos de esa ruta** — ver el paso 3 del flujo.

## Flujo

1. **UI:** menú de la conversación → "Marcar como spam" → diálogo de confirmación que enumera
   lo que se va a hacer **y lo que se pierde de forma irreversible** (la PII).
2. `POST /api/conversations/[id]/actions` con `{action:"mark_spam", reason?}`.
3. **Gate de rol.** Roles efectivos: `ADMIN`, `DIRECTOR`, `GERENTE`, `DEVELOPER_EXT`,
   `MANTENIMIENTO` — la unión de `FULL_ACCESS_ROLES` y `PLAZA_ACCESS_ROLES` tal y como están
   escritos hoy en `src/app/api/contacts/route.ts`. Esas constantes están **duplicadas en cada
   route file**; se exporta la lista una vez desde el módulo de moderación y se usa ahí. No se
   refactorizan las demás rutas: queda fuera de este trabajo.

   **`mark_spam` se resuelve ANTES del gate genérico de la ruta, no dentro de él.** Esa ruta ya
   filtra por `isOwner || MANAGER_ROLES` (`["ADMIN","DIRECTOR","GERENTE","TEAM_LEADER"]`), que no
   es el mismo conjunto. Si `mark_spam` cayera en ese gate pasarían dos cosas mal: un **asesor**
   dueño del hilo podría borrar el contacto, y **DEVELOPER_EXT** o **MANTENIMIENTO** serían
   rechazados aunque el borrado de contactos sí se lo permite. Ser dueño del hilo **no** habilita
   marcar spam: manda solo la lista de roles.
4. **Salvaguarda:** contar `deals` y `walkIns` del contacto. Si hay alguno → `409` enumerando
   qué lo bloquea. Las cotizaciones **no se cuentan aparte** porque `Quote` cuelga de `Deal`
   (`dealId`), no del contacto: sin deals no puede haber cotizaciones. Actividades y mensajes
   no bloquean — los produce el propio spam.
5. **Transacción** con `withChangeSource({source:"ui", actorId})`:
   - alta o reactivación en `blocked_senders` con el identificador copiado del contacto, estado
     `PENDING`;
   - contacto: `deletedAt = now()`, PII a null, `tags += "SPAM"`,
     `contactStatus: DESCARTADO`, `doNotContact: true`;
   - contacto: `instagramId = null`, `messengerPsid = null`. **Obligatorio, no cosmético:**
     `contacts_instagramId_key` y `contacts_messengerPsid_key` son índices UNIQUE parciales
     (`WHERE ... IS NOT NULL`), así que dejarlos puestos en la fila anonimizada impediría para
     siempre crear un contacto legítimo futuro con ese mismo id. El identificador ya está a
     salvo en `blocked_senders`.
   - conversación: `status: CLOSED`, `botEnabled: false`, `unreadCount: 0`,
     `controlledById: null`.
6. **Fuera de la transacción**, sin poder lanzar: `blockOnMeta()`. Escribe `metaBlockStatus`,
   `metaSpamStatus` y `metaError`.
7. La respuesta trae las dos mitades por separado, para que la UI diga "bloqueado" o "limpiado
   en el CRM, falló en Meta — reintentar".

`comment_rule_logs` se queda tal cual: su `contactId` sigue apuntando al contacto ya
anonimizado, y eso conserva la trazabilidad de qué regla trajo a esa persona. El
`ON DELETE SET NULL` solo entraría en juego con un borrado duro, que este diseño no hace.

## Que no vuelva a entrar — dos puertas

- **`handleInboundMessage`** (`src/lib/messaging/core.ts`), antes de `findContactByChannel`:
  si el remitente está bloqueado, `return null` y un `console.warn`. Un solo punto cubre
  WhatsApp, Instagram y Messenger.
- **`handleComment`** (`src/lib/comments/handle-comment.ts`): si el autor del comentario está
  bloqueado, no se publica respuesta pública ni sale DM. Sin esto el spammer sigue disparando
  reglas aunque no pueda escribir por DM.

## Errores

Se tratan por nombre, no en genérico:

- **`3801`** — el tope de personas bloqueadas de la Página está alcanzado.
- **`3802`** — no se puede rebloquear tan pronto después de desbloquear.
- **Sin conversación previa en IG** — `moderate_conversations` exige que la conversación
  exista. Si el spam llegó **solo por comentario** y nunca hubo DM, el bloqueo de Instagram va
  a fallar. Es una limitación de Meta, no un bug: queda `FAILED` con ese motivo y la lista
  propia hace el trabajo. El diálogo de la UI no debe prometer lo contrario.
- **Conector sin `pageAccessToken`** → `SKIPPED` con motivo, no `FAILED`.

## Reversibilidad — parcial

Se puede deshacer el bloqueo: `unblock_user` o `DELETE /{page-id}/blocked`, marcar
`unblockedAt`, y reactivar el contacto (`deletedAt = null`). **La PII anonimizada no se
recupera nunca.** El diálogo de confirmación lo dice de forma explícita, y es la razón de que
exista la salvaguarda del paso 4.

Vive en una lista mínima en el área de admin: `blocked_senders` con "desbloquear" y "reintentar
bloqueo". Es además el único sitio razonable para reintentar los `FAILED`, y sigue el patrón de
`/api/admin/comment-rules/logs/[id]/retry` que ya existe.

## Tests (vitest)

Junto al módulo, como `handle-comment.test.ts`:

- `block-sender.test.ts` — aborta con deal; aborta con walk-in; anonimiza la PII y limpia
  `instagramId`/`messengerPsid`; cierra la conversación y apaga el bot; marcar dos veces la
  misma conversación no duplica fila en `blocked_senders`.
- `meta-moderation.test.ts` — con `fetch` inyectado: payload correcto para IG
  (`moderate_conversations` con las dos acciones) y para Messenger (`/blocked` con `psid`);
  mapeo de `3801` y `3802`; conector sin token → `SKIPPED`; nunca lanza.
- `is-blocked.test.ts` — respeta `unblockedAt`.
- Un caso en el test de `handleInboundMessage` que confirme que un remitente bloqueado no crea
  contacto ni mensaje.

## Fuera de alcance (YAGNI)

- Ocultar o borrar los comentarios del spammer (`POST /{ig-comment-id}?hide=true`,
  `DELETE /{ig-comment-id}`). Existe y funciona, pero se decidió no incluirlo.
- Bloqueo en WhatsApp: no hay API. La lista propia lo cubre si algún día llega un inbound.
- Detección automática de spam.
- Refactor de las constantes de rol duplicadas en el resto de las rutas.
