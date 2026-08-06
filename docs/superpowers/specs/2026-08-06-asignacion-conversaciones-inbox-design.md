# Asignación de conversaciones del Inbox a usuarios — Diseño

**Fecha:** 2026-08-06 · **Estado:** aprobado por Luis (diseño conceptual 2026-07-23; este spec 2026-08-06)
**Rama:** `feat/inbox-asignacion` · **Base:** `main@4010740`

## 1. Problema

El Inbox (`/inbox`) no tiene forma de asignar un hilo a un usuario. El dueño de un contacto
(`Contact.assignedToId`) solo se setea por el routing de leads al capturarse; los contactos que
nacen por DM (IG/Messenger/WhatsApp) suelen quedar sin asignar y no hay UI ni API para
reclamarlos o repartirlos desde el Inbox. Además, al revisar el código se encontraron dos
defectos que esta feature debe cerrar por coherencia:

- **Fuga del search** (`api/conversations/route.ts:39-48`): el bloque de búsqueda sobreescribe
  el `OR` del aislamiento por rol → un asesor que busca ve hilos de contactos ajenos. Misma
  clase que la fuga `?userId=` corregida en `af41c4f`.
- **Envío sin gate** (`api/conversations/[id]/messages/route.ts`): cualquier sesión autenticada
  puede enviar mensajes en cualquier hilo por ID; no valida dueño ni rol.

## 2. Decisiones (aprobadas)

| Decisión | Valor |
|---|---|
| Dueño del hilo | `Contact.assignedToId` (nivel contacto, NO por conversación — asignar en el inbox = asignar el contacto en todo el CRM) |
| Asignación automática | **Solo auto-claim**: el primer usuario no-mando que envía un mensaje real en un hilo sin asignar se queda el contacto. SIN round-robin para DMs (el bot atiende mientras nadie reclama). |
| Quién asigna a otros | Mando = `ADMIN`, `DIRECTOR`, `GERENTE`, `TEAM_LEADER` |
| Asesor (no-mando) | Solo *claim* a sí mismo, y solo si el contacto está sin asignar |
| Notificación | In-app (`Notification`, `type="conversation_assigned"`), sin email. `Notification.type` es String → **cero migraciones**. |
| Enfoque | A: acción `assign` en la ruta de acciones existente + módulo puro `src/lib/inbox/assign.ts` |

## 3. Módulo núcleo — `src/lib/inbox/assign.ts`

Función pura respecto a permisos, con I/O Prisma inyectable en tests (mismo patrón que
`lib/moderation/block-sender.ts`).

```ts
assignContact({
  contactId: string,
  assigneeId: string | null,   // null = quitar asignación (solo mando)
  actor: { id: string; role: UserRole },
}): Promise<
  | { ok: true; assignedToId: string | null }
  | { ok: false; code: "sin-permiso" | "ya-asignado" | "no-existe"
      | "usuario-invalido" | "conflicto" }
>
```

Reglas, en orden:
1. Contacto debe existir y no estar `deletedAt` → si no, `no-existe`.
2. **Mando** (`INBOX_MANAGERS`): puede asignar, reasignar y quitar (`assigneeId: null`).
3. **No-mando**: solo `assigneeId === actor.id` Y `contact.assignedToId === null`;
   si el contacto ya tiene dueño → `ya-asignado`; si intenta asignar a un tercero o
   desasignar → `sin-permiso`.
4. **Asignado válido**: usuario existente, `isActive`, y su email NO termina en `.local`
   (espíritu del gate anti-QA AUD-09; los usuarios de prueba no reciben leads ni a mano).
   Si no → `usuario-invalido`. No aplica cuando `assigneeId: null`.
5. Escritura con **lock optimista** sobre el `updatedAt` del contacto leído (si cambió entre
   lectura y update → `conflicto`, el cliente recarga). Envuelta en
   `withChangeSource({ source: "inbox_assign", actorUserId: actor.id })` → la cronología
   del contacto lo registra sin trabajo extra (mismo mecanismo que `source='routing'`).
6. **Side-effects post-escritura, cada uno en try/catch** (lección 2026-07-24: un side-effect
   jamás tumba la operación):
   - `Activity` NOTE al contacto: "Asignó la conversación a {nombre}" / "Reclamó la
     conversación" / "Quitó la asignación", `userId = actor.id`.
   - `Notification` al asignado: `type="conversation_assigned"`, `title/message` con nombre
     del contacto, `link=/inbox?focus={conversationId}` (la ruta de acciones le pasa el
     `conversationId` para armar el link; el módulo lo recibe opcional). **No** se crea si
     `assigneeId === actor.id` (claim propio) ni si `assigneeId === null`.

`auto-claim` reutiliza `assignContact` con el actor = remitente (pasa las reglas de no-mando
por construcción) y `source: "inbox_autoclaim"` como override del changeSource para que la
cronología distinga claim explícito de implícito.

## 4. Roles — `src/lib/inbox/roles.ts`

Dos constantes, exportadas y documentadas (hoy hay dos sets desalineados inline):

- `INBOX_FULL_VIEW = ["ADMIN", "DIRECTOR", "GERENTE"]` — quién ve TODO el inbox en la lista.
  **Sin cambio de alcance**: TEAM_LEADER sigue viendo suyos + sin asignar.
- `INBOX_MANAGERS = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"]` — quién ejecuta acciones
  de mando (asignar/reasignar/quitar; y el set que ya usaba la ruta de acciones para
  takeover/close). TEAM_LEADER reparte la cola "sin asignar" sin que se le amplíe la vista.

Ambas rutas (`conversations/route.ts` y `[id]/actions/route.ts`) y el gate nuevo de envío
importan de aquí. Test anti-clase: toda constante es subconjunto del enum `UserRole`.

## 5. API — acción `assign` en `POST /api/conversations/[id]/actions`

- Schema: `action: "assign"` + `assigneeId: z.string().min(1).nullable()` (sin asumir formato
  del id — la validación real de existencia la hace `assignContact`, regla 4).
- Se resuelve **ANTES del gate genérico owner|manager** (mismo patrón y por la misma razón
  que `mark_spam`): un hilo sin asignar no tiene dueño y el gate genérico devolvería 403 al
  claim de un asesor. El permiso real lo decide `assignContact` (regla 2-3).
  Tests en las dos direcciones ([[feedback_accion_destructiva_hereda_gate_ajeno]]):
  el claim de no-dueño sobre hilo libre pasa; la reasignación de no-mando sobre hilo ajeno da 403.
- Mapeo de códigos: `sin-permiso`→403, `ya-asignado`→409, `no-existe`→404,
  `usuario-invalido`→422, `conflicto`→409 ("El hilo cambió, recarga").
- Respuesta: `{ data: { assignedTo: { id, name } | null } }` para update optimista de la UI.

## 6. Auto-claim + gate de envío — `POST /api/conversations/[id]/messages`

En el envío de mensaje **real** (no `internalNote`):
1. El `select` del contacto agrega `assignedToId`.
2. **Gate nuevo**: si `contact.assignedToId` ≠ null, ≠ `session.user.id` y el remitente no
   está en `INBOX_MANAGERS` → **403** ("El contacto está asignado a otro asesor"). Hoy esa
   ruta no valida nada — es el único cambio de comportamiento para usuarios existentes, y es
   coherente con el aislamiento de la lista (un asesor ni siquiera debería ver ese hilo).
3. **Auto-claim**: si `assignedToId === null` y el remitente **no es mando** → tras el envío
   exitoso, `assignContact` (claim, `source: "inbox_autoclaim"`) en try/catch — si el claim
   falla (p. ej. carrera con otra asignación), el mensaje YA salió y no se revierte; el
   siguiente envío re-evalúa. Mando que responde NO reclama (triagea sin quedarse el lead).
4. Las **notas internas** ni gatean ni reclaman (cualquier rol con acceso al hilo puede anotar).

## 7. Fix de la fuga del search — `GET /api/conversations`

Componer, no sobreescribir. El `where.contact` final se arma como
`{ AND: [scopePorRol?, filtro?, búsqueda?] }` donde cada término es opcional — el `OR` del
aislamiento y el `OR` del search conviven dentro del `AND`. Los filtros `mine`/`unassigned`
también entran al `AND` (hoy REEMPLAZAN el scope; son subconjuntos, pero el patrón invita a
la próxima fuga). La lista expone además `INBOX_FULL_VIEW` importado (§4).

## 8. UI — `src/components/inbox/inbox-view.tsx` (+ header del hilo)

- **Header del hilo**: chip con `Asignado a: {nombre}` o `Sin asignar`.
  - Mando: el chip abre un menú con los usuarios activos (fetch a `/api/users` existente,
    excluyendo `.local`) + opción "Quitar asignación".
  - No-mando: si el hilo está libre, botón "Reclamar"; si es suyo, chip informativo;
    si es de otro, no lo ve (aislamiento) — sin UI extra.
- **Lista**: badge "Sin asignar" cuando `contact.assignedTo === null`
  (el payload ya trae `assignedTo {id, name}`).
- Update optimista con la respuesta de la acción; el polling de 5s reconcilia.
- La cola "sin asignar" ya existe (filtro `unassigned`) — sin cambios.

## 9. Testing (TDD, orden de construcción)

1. `roles.test.ts` — constantes ⊆ enum `UserRole`; TEAM_LEADER en MANAGERS y no en FULL_VIEW.
2. `assign.test.ts` — matriz rol × operación (claim / assign / reassign / unassign / claim
   sobre asignado / assign a `.local` / a inactivo / a inexistente / contacto borrado /
   lock optimista); side-effects: Notification creada (y NO en claim propio), Activity
   creada, fallo de side-effect no rompe la operación.
3. `actions/route.test.ts` — `assign` se resuelve antes del gate (2 direcciones), mapeo de
   códigos HTTP, payload inválido 400.
4. `messages/route.test.ts` — gate 403 a ajeno no-mando, mando pasa sin reclamar, auto-claim
   en hilo libre (y con `source` correcto), nota interna ni gatea ni reclama, claim fallido
   no revierte el envío.
5. `conversations/route.test.ts` — search compone con el scope (la fuga, test de regresión),
   filtros dentro del AND.

Gates de salida: `tsc` sin errores nuevos · `npm test` verde · `next build` exit 0 ·
`npm run lint` sin errores nuevos.

## 10. Fuera de alcance

- Round-robin / reparto automático para DMs (decidido: solo auto-claim).
- Scoping por equipo del inbox para TEAM_LEADER (hoy: suyos + sin asignar; no cambia).
- Notificaciones por email o WhatsApp al asignado.
- Reasignación masiva / multi-select en la lista.
- Contador en el tab de la cola "sin asignar".

## 11. Riesgos aceptados

- **Carrera claim vs claim**: dos asesores reclaman a la vez → gana el primero por el lock
  optimista del contacto; el segundo recibe `conflicto`/`ya-asignado` y recarga.
- **Auto-claim post-envío**: si el claim falla, queda un mensaje de un asesor en un hilo sin
  asignar — estado igual al actual, se corrige en el siguiente envío o a mano.
- **El gate de envío puede sorprender** a quien hoy escribía en hilos ajenos por URL directa;
  es el comportamiento correcto y la lista nunca le mostró esos hilos.
