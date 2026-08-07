# Ciclo de vida de usuarios en Admin → Usuarios & Roles

**Fecha:** 2026-08-07
**Rama:** `feat/admin-user-lifecycle` (desde `main` @ `ef39c69`)
**Estado:** diseño aprobado por Luis

## Problema

La pestaña `/admin?tab=users` solo permite **editar** un usuario y **activar/desactivar**
(`isActive`). Falta todo lo demás del ciclo de vida:

- No hay forma de cambiar la contraseña de un usuario después de crearlo. El único punto donde
  se hashea una contraseña es `createUser`.
- `User.deletedAt` existe en el schema pero **ninguna** función lo escribe ni lo ofrece la UI.
- No hay estado intermedio: o el usuario entra, o está "desactivado" sin matiz ni motivo.
- Cuando alguien deja el equipo, su cartera (contactos, negocios, conversaciones, unidades
  reservadas, walk-ins, cotizaciones) queda colgada de una cuenta que ya nadie usa.

## Alcance

Dentro:
- Estado de usuario a 3 valores: Activo / Suspendido / Inactivo.
- Soft delete (`deletedAt`) con restauración.
- Cambio de contraseña por un administrador, mostrada una sola vez.
- Reasignación de activos de un usuario a otro, como acción propia y como paso opcional
  dentro de suspender / dar de baja / eliminar.
- Bitácora (`AuditLog`) de todas las acciones anteriores.

Fuera (decidido explícitamente):
- **Traspaso de equipos y territorios.** `teamMembers`, `ledTeams`, `territoryMemberships`
  y `forecastTeams` NO se mueven. En su lugar, los guards bloquean la baja de un líder con
  gente colgando (ver §5).
- Forzar cambio de contraseña en el siguiente login (`mustChangePassword`).
- Envío de la contraseña o de un enlace de reseteo por correo.
- Reactivación automática por fecha (`suspendedUntil` + cron).

## 1. Modelo de estados

Cuatro situaciones posibles, con dos campos ortogonales:

| Situación | `status` | `isActive` | `deletedAt` | Visible en la tabla | Entra al CRM | Recibe leads |
|---|---|---|---|---|---|---|
| Activo | `ACTIVE` | `true` | `null` | sí | sí | sí |
| Suspendido | `SUSPENDED` | `false` | `null` | sí | no | no |
| Inactivo (baja) | `INACTIVE` | `false` | `null` | sí | no | no |
| Eliminado | `INACTIVE` | `false` | fecha | solo con "Ver eliminados" | no | no |

**Suspendido vs Inactivo:** ambos bloquean el acceso; la diferencia es de intención y de
lectura del panel. *Suspendido* es temporal y lleva motivo obligatorio (`suspensionReason`) y
fecha (`suspendedAt`) — el caso "está en veremos, no le manden leads". *Inactivo* es baja
definitiva sin motivo requerido. El código no los trata distinto en ningún gate; la
distinción es informativa para quien administra.

**Inactivo vs Eliminado:** un usuario Inactivo sigue en la tabla y se puede reactivar de un
clic. Un Eliminado desaparece de la vista por defecto y solo reaparece con el toggle
"Ver eliminados", desde donde se restaura.

`restoreUser` devuelve al usuario a **Inactivo**, nunca a Activo: restaurar y volver a dar
acceso son dos decisiones distintas y deben ser dos clics distintos.

## 2. Migración de schema

Additiva. Un solo archivo en `prisma/migrations-manual/2026-08-07-admin-user-lifecycle.sql`:

```sql
CREATE TYPE propyte_crm."UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

ALTER TABLE propyte_crm.users
  ADD COLUMN "status"            propyte_crm."UserStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "suspendedAt"       timestamptz,
  ADD COLUMN "suspensionReason"  text,
  ADD COLUMN "statusChangedById" uuid,
  ADD COLUMN "statusChangedAt"   timestamptz,
  ADD COLUMN "passwordChangedAt" timestamptz;

ALTER TABLE propyte_crm.users
  ADD CONSTRAINT "users_statusChangedById_fkey"
  FOREIGN KEY ("statusChangedById") REFERENCES propyte_crm.users("id");

-- Backfill: lo que hoy está desactivado pasa a Inactivo, no a Suspendido.
UPDATE propyte_crm.users SET "status" = 'INACTIVE' WHERE "isActive" = false;

CREATE INDEX "users_status_idx" ON propyte_crm.users ("status");
```

Los identificadores van en **camelCase entrecomillado**: el schema de Prisma no usa `@map`
en las columnas de `User`, así que en Postgres se llaman `"isActive"`, `"deletedAt"`,
`"passwordHash"`. Escribirlos en snake_case crearía columnas nuevas en silencio.

El `.prisma` se actualiza en paralelo (enum `UserStatus` + los 6 campos + la autorrelación
`statusChangedBy` / `statusChangesMade`) y se verifica con `prisma generate`. No se corre
`db push` — la migración se aplica con el `.sql` de arriba.

### `isActive` se queda como espejo

`isActive` **no** se elimina. Es la derivada `status === 'ACTIVE'` y sigue siendo el campo que
aplican los gates existentes:

| Punto de aplicación | Archivo |
|---|---|
| Login por contraseña y por OTP | `src/lib/auth/options.ts:85` |
| Recuperación de contraseña | `src/app/api/auth/forgot-password/route.ts:32` |
| Solicitud de código | `src/app/api/auth/request-code/route.ts:36` |
| Reseteo con código | `src/app/api/auth/reset-password/route.ts:34` |
| Elegibilidad de ruteo de leads | `src/lib/workflows/routing.ts:64` |
| Selector de asesor en contactos | `src/app/api/contacts/route.ts:115` |

Migrar esos seis a `status` es más limpio pero toca login y ruteo en producción por una
feature de administración. El precio del espejo es que puede desincronizarse; la mitigación
es estructural: **`setUserStatus()` es el único escritor de `status` e `isActive` en todo el
código**, y `updateUserSchema` deja de aceptar `isActive` para que nadie lo escriba por la
puerta de atrás. Un test verifica que ninguna otra ruta escriba `isActive` sobre `User`.

### Bug latente que se arregla aquí

Ninguno de los cuatro gates de autenticación revisa `deletedAt`. Hoy da igual porque nada
escribe ese campo, pero en el momento en que `softDeleteUser` exista, un usuario eliminado
cuyo `isActive` siguiera en `true` podría entrar. `softDeleteUser` escribe ambos campos de
forma atómica, y además los cuatro gates añaden `deletedAt: null` a su condición — defensa en
profundidad, no confianza en que el escritor haga su parte.

## 3. Server actions

Todas en `src/server/admin.ts`, todas detrás de `requireAdminRole()` más el guard de rol
específico de §5, todas escriben `AuditLog`.

### `setUserStatus(id, status, reason?)`
Único escritor de `status` + `isActive` + `suspendedAt` + `suspensionReason` +
`statusChangedById` + `statusChangedAt`. `reason` es obligatorio cuando `status === 'SUSPENDED'`.
Reemplaza a `deactivateUser`, que se elimina junto con la rama `isActive` de `updateUser`.

### `adminResetPassword(id, password?)`
Si no llega `password`, genera una de 16 caracteres con `randomBytes`. Hashea con
`bcryptjs` a 12 rondas — igual que `createUser`. Sella `passwordChangedAt`. Devuelve
`{ password: raw }` **una sola vez**; nada la persiste en claro y no vuelve a estar
disponible. El `AuditLog` registra que hubo un reseteo, nunca el valor.

### `softDeleteUser(id, opts?)`
En una `$transaction`: si `opts.reassignTo` viene, corre la reasignación primero; luego
escribe `deletedAt = now()`, `isActive = false`, `status = 'INACTIVE'`. El orden importa —
si la reasignación falla, el usuario no queda eliminado con la cartera colgando.

### `restoreUser(id)`
`deletedAt = null`, `status = 'INACTIVE'`. No reasigna nada de vuelta: lo que se movió, se
movió.

### `getUserAssetCounts(id)`
Conteos reales por scope, para que el diálogo muestre qué se va a mover antes de moverlo.
Cuenta solo lo vivo (`deletedAt: null` donde el modelo lo tenga).

### `reassignUserAssets(fromId, toId, scopes)`
`scopes` es un arreglo de las claves de §4. Cada scope es un `updateMany` dentro de una
`$transaction`; los lotes grandes van en chunks de 50 registros para no reventar el
timeout del pooler (mismo patrón que el sync de meta-leads). Devuelve el conteo movido por
scope, que es lo que se muestra en el toast y lo que se guarda en `AuditLog.changes`.

## 4. Scopes de activos

Nombres de FK verificados contra `prisma/schema.prisma`:

| Scope | Modelo.campo | Nota |
|---|---|---|
| `contacts` | `Contact.assignedToId` | filtra `deletedAt: null` |
| `deals` | `Deal.assignedToId` | filtra `deletedAt: null`; el campo es obligatorio |
| `conversations` | `Conversation.controlledById` | el modelo no tiene `deletedAt` |
| `units` | `Unit.reservedByUserId` | `reservedByContactId` no se toca |
| `walkins` | `WalkIn.assignedAdvisorId` | ver abajo |
| `quotes` | `Quote.createdById` | ver abajo |

Dos aclaraciones que cambian el significado del dato:

- **`WalkIn.hostessId` no se mueve.** Es el registro histórico de quién recibió a la persona
  en el showroom, no una asignación de trabajo. Solo se mueve `assignedAdvisorId`.
- **`Quote.createdById` sí se mueve, y eso reescribe la autoría.** Es el único vínculo de la
  cotización con un usuario, y sin moverlo nadie puede darle seguimiento. El
  `AuditLog.changes` guarda el `fromId` original para que la autoría real siga siendo
  reconstruible.

Mover conversaciones libera además el lock de takeover del inbox: si el usuario origen tenía
un hilo tomado, pasa al destino en el mismo `updateMany` (`controlledById`), sin dejar el
hilo bloqueado por una cuenta muerta.

## 5. Guards

**Por rol** — `ADMIN_ROLES` actual es `["ADMIN", "DIRECTOR", "GERENTE"]`:

| Acción | Roles permitidos |
|---|---|
| Ver la tabla, editar, mover activos | ADMIN, DIRECTOR, GERENTE |
| Suspender / reactivar / dar de baja | ADMIN, DIRECTOR, GERENTE |
| Cambiar contraseña | ADMIN, DIRECTOR |
| Eliminar / restaurar | ADMIN, DIRECTOR |

**Invariantes**, verificados en el servidor y no solo en la UI:

1. Nadie se suspende, da de baja, elimina ni se cambia la contraseña a **sí mismo**.
2. No se puede dejar el sistema sin administradores: la última cuenta Activa con rol ADMIN
   o DIRECTOR no se puede suspender, dar de baja ni eliminar.
3. **No se suspende, da de baja ni elimina a quien tenga `teamMembers` activos, `ledTeams`
   o membresías de territorio.** Como el traspaso de equipos quedó fuera de alcance, la
   acción se detiene con un mensaje que nombra a los subordinados y pide reasignarlos antes.
   La alternativa —dejar que se ejecute— produciría subordinados colgando de una cuenta
   eliminada y ruteo por territorio hacia un usuario que no existe.
4. El destino de una reasignación debe estar **Activo** y no eliminado. Si es de otra plaza,
   el diálogo avisa pero no bloquea (hay casos legítimos de cobertura cruzada).
5. Origen y destino no pueden ser el mismo usuario.

Cada rechazo lanza un `Error` con mensaje en español, que la UI muestra en el toast.

## 6. UI

### Tabla (`src/components/admin/admin-content.tsx`, tab `users`)
- `USER_STATUS_CONFIG` pasa de dos entradas booleanas a tres por `status`: Activo (verde),
  Suspendido (ámbar), Inactivo (gris). El badge de Suspendido muestra el motivo en `title`.
- Columna nueva **Activos**: contactos + negocios vivos del usuario, para ver de un vistazo
  a quién le cuelga cartera antes de darle de baja.
- Filtro nuevo por estado, junto a los de rol y plaza.
- Toggle **"Ver eliminados"**: incluye los `deletedAt != null` en gris tachado, con acción
  Restaurar.
- Los botones sueltos de la columna Acciones se reemplazan por un menú `⋯`: Editar ·
  Cambiar contraseña · Mover activos · Suspender/Reactivar · Dar de baja · Eliminar. Las
  entradas que el rol actual no puede ejecutar no se renderizan.

### Diálogos nuevos
1. **`password-reset-dialog.tsx`** — escribir o generar; al confirmar muestra la contraseña
   en un banner con botón de copiar y el aviso de que no se volverá a mostrar. Mismo patrón
   que la generación de API keys en `integrations-tab.tsx`.
2. **`user-status-dialog.tsx`** — elegir estado destino + motivo (obligatorio si es
   Suspendido). Si el usuario tiene activos, ofrece el paso de reasignación en el mismo flujo.
3. **`reassign-assets-dialog.tsx`** — selector de destino + un checkbox por scope con su
   conteo real de `getUserAssetCounts`. Los scopes en cero se muestran deshabilitados, no
   ocultos: que un scope esté vacío es información.
4. La eliminación pide **teclear el nombre del usuario** para confirmar.

### Sin `window.location.reload()`
Los handlers de usuario (`handleCreateUser`, `handleUpdateUser`, `handleToggleActive`)
recargan la página hoy. Los nuevos actualizan el estado local con lo que devuelve la server
action. No es preferencia de estilo: el reload fue exactamente el bug que se comió la API
key recién generada en abril (`618fa7f`), y con una contraseña que se muestra una sola vez
el fallo sería idéntico e irreversible.

## 7. Verificación

Tests con vitest, junto a las funciones que prueban:

- **Espejo:** `setUserStatus` deja `isActive` coherente con `status` en los tres valores;
  ninguna otra ruta escribe `isActive` sobre `User`.
- **Guards:** los cinco invariantes de §5, cada uno en su caso de rechazo *y* en su caso de
  aceptación — un test que solo prueba el rechazo pasa igual si el guard rechaza todo.
- **Reasignación:** mueve exactamente los scopes marcados y **ninguno más**; `hostessId`
  sigue apuntando al usuario origen después de mover walk-ins; el conteo devuelto coincide
  con las filas realmente modificadas.
- **Atomicidad:** si la reasignación falla a mitad, el usuario no queda con `deletedAt`.
- **Autenticación:** un usuario con `deletedAt` no pasa ninguno de los cuatro gates.

Cada test se valida rompiendo a propósito el código que prueba y confirmando que falla.
Gates de siempre antes de cerrar: `npx tsc --noEmit`, `npm run build`, suite completa.

## 8. Dependencias externas

1. **La migración va a la Supabase compartida `oaijxdpevakashxshhvm`.** No se aplica de
   forma autónoma. Se entrega el `.sql` y lo ejecuta Luis, o autoriza explícitamente su
   aplicación.
2. `main` local tiene **29 commits sin pushear** (`ef39c69`). El trabajo va en
   `feat/admin-user-lifecycle` y no toca ese pendiente.
3. Hasta que la migración esté aplicada, el código que lee `status` no funciona contra la
   base real. El orden de entrega es: migración → server actions → UI.
