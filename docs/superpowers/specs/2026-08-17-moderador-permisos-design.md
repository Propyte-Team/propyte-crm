# Moderador de permisos por rol y por persona

**Fecha:** 2026-08-17
**Estado:** decisiones cerradas 2026-08-17 (§12); listo para escribir el plan de implementación
**Detonante:** dar a la diseñadora (`design@nativatulum.mx`, rol `MARKETING`) acceso a las reglas de comentarios sin convertirla en `ADMIN`.

---

## 1. El problema

Hoy el CRM no tiene una capa de permisos. Tiene **listas de roles escritas a mano, repetidas en más de 60 archivos**: cada server action, cada `route.ts` y cada página guarda su propio `["ADMIN","DIRECTOR","GERENTE"]`. Cambiar quién puede hacer algo significa encontrar todas las copias, editarlas y desplegar.

Tres consecuencias que ya se cobraron:

1. **`ADMIN` es comodín.** En [`nav-config.ts`](../../../src/components/layout/nav-config.ts) la regla es literalmente `role === "ADMIN" || item.roles.includes(role)`. Dar un permiso puntual obliga a dar todos: comisiones de cada asesor, todos los contactos, la configuración del bot y las API keys.
2. **Las copias se separan.** Las 5 rutas de `comment-rules` tenían la misma lista duplicada; el commit `fa5c1ef8` las unificó, pero ese patrón sigue vivo en el resto del sistema.
3. **El permiso no distingue personas.** `MARKETING` no es una persona: incluye a la diseñadora y a `pantallapdc@propyte.local`, una cuenta de pantalla. Cualquier permiso colgado del rol se lo lleva también el kiosco.

## 2. Los dos ejes (y por qué este proyecto solo toca uno)

El CRM tiene dos preguntas de autorización distintas, y confundirlas es la forma más rápida de romper esto:

| Eje | Pregunta | Dónde vive hoy | ¿Lo toca este proyecto? |
|---|---|---|---|
| **Acceso a función** | ¿Puedo entrar a la pantalla de comentarios? ¿Puedo crear usuarios? | Listas de roles en 60+ archivos | **Sí** |
| **Alcance de datos** | De los contactos, ¿veo los míos, los de mi equipo o todos? | [`src/lib/rbac/query-scope.ts`](../../../src/lib/rbac/query-scope.ts) | **No** |

`query-scope.ts` ya resuelve el segundo eje bien, y su propio comentario advierte que los sets de roles viven por módulo a propósito porque **no son iguales** (comisiones mete a `GERENTE` en `full`; contactos tiene un nivel `PLAZA` aparte). Unificarlos cambiaría permisos en silencio.

**Decisión: el moderador gobierna el eje de funciones. El alcance de datos se queda donde está.** Un permiso concede la entrada a una función; una vez dentro, cuántas filas ves lo sigue decidiendo `query-scope`. Fusionar los dos ejes es un proyecto aparte y probablemente innecesario.

## 3. Alcance

**Entra:**
- Catálogo de permisos con nombre estable.
- Default por rol, editable.
- Excepciones por persona (conceder y revocar).
- Un único helper `can()` que resuelve todo.
- Pantalla de administración del moderador.
- Migración por fases de las superficies existentes, empezando por `/admin`.

**No entra:**
- Alcance de datos (ver arriba).
- Permisos por plaza o por equipo. Si `MARKETING` de Tulum debe ver algo distinto que `MARKETING` de PdC, eso es una excepción por persona hasta que haya evidencia de que se necesita la dimensión completa.
- Permisos sobre registros individuales ("este contacto sí, ese no").
- Migrar las 60+ superficies de un tirón. Ver §8.

## 4. Modelo de datos

Tres piezas. Las dos tablas van al esquema `propyte_crm`, con `@@map` en snake_case como el resto.

### 4.1 Catálogo — en código, no en base

```ts
// src/lib/permissions/catalog.ts — módulo PURO
export const PERMISSIONS = {
  "comentarios.gestionar": { label: "Reglas de comentarios en redes" },
  "usuarios.ver":          { label: "Ver la lista de usuarios" },
  "usuarios.editar":       { label: "Crear y editar usuarios" },
  "usuarios.password":     { label: "Restablecer contraseñas de otros", sensitive: true },
  "comisiones.ver":        { label: "Ver el tablero de comisiones" },
  "comisiones.reglas":     { label: "Editar las reglas de comisión" },
  "bot.configurar":        { label: "Configuración del bot y playbooks" },
  "integraciones.gestionar": { label: "Conectores y API keys" },
  "permisos.gestionar":    { label: "Administrar este moderador", sensitive: true },
  // …se agregan conforme cada fase migra su superficie
} as const;

export type Permission = keyof typeof PERMISSIONS;
```

**`sensitive: true` — el segundo nivel.** Un permiso sensible es el que permite *volverse otra persona* o *repartirse a sí mismo el resto*:

- `usuarios.password` — quien lo tiene le pone contraseña a cualquiera y entra como esa persona. En la práctica es "ser quien sea", incluido el dueño del CRM.
- `permisos.gestionar` — quien lo tiene se administra los permisos, empezando por los suyos.

**`integraciones.gestionar` NO es sensible, y conviene explicar por qué**, porque da acceso a las API keys y el instinto dice lo contrario. Marcarlo sensible significaría "sin default de rol", y eso se lo quitaría también a `DIRECTOR` — un cambio que nadie decidió. La decisión tomada fue únicamente que `GERENTE` lo pierda (§12.3), y eso se logra con la divergencia declarada de §8.1.

Si más adelante se quiere que las API keys sean estrictamente por persona, el camino es partir el permiso en `integraciones.conectores` y `integraciones.apikeys` —que en el código ya son superficies distintas— y marcar sensible solo al segundo. Es un cambio posterior, no parte de la fase 0.

Un permiso sensible **no puede tener default de rol**: no existe su casilla en la matriz. Solo se concede a una persona concreta, desde la vista de Persona, y con una razón escrita obligatoria. La diferencia importa: marcar una casilla en la matriz le da la capacidad a *todo un rol* —los 12 asesores de un tirón— con un clic y sin que quede dicho por qué.

El catálogo vive en código **a propósito**: una clave de permiso está acoplada al código que la consulta. Si viviera en base, alguien podría borrar `comentarios.gestionar` desde una UI y dejar un `can()` preguntando por algo inexistente. En código, TypeScript no deja escribir una clave que no existe, y el catálogo es la lista que dibuja la pantalla del moderador.

### 4.2 `role_permissions` — el default de cada rol

```prisma
model RolePermission {
  id         String   @id @default(uuid())
  role       UserRole
  permission String
  createdAt  DateTime @default(now())

  @@unique([role, permission])
  @@map("role_permissions")
  @@schema("propyte_crm")
}
```

Presencia de la fila = concedido. Se siembra con las listas que hoy están hardcodeadas, para que el día 1 nadie gane ni pierda nada — **con una excepción deliberada**, ver §8.1.

Un permiso con `sensitive: true` **nunca** tiene fila aquí. Un guardia en el server action lo rechaza, y un test lo fija: si alguien agrega la clave sensible a la semilla, el test truena antes del deploy.

### 4.3 `user_permission_overrides` — la excepción por persona

```prisma
model UserPermissionOverride {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  permission String
  granted    Boolean  // true = concede aunque su rol no lo tenga; false = revoca aunque sí
  reason     String?  // por qué; se muestra en la UI. OBLIGATORIO si el permiso es sensible
  createdAt  DateTime @default(now())

  @@unique([userId, permission])
  @@map("user_permission_overrides")
  @@schema("propyte_crm")
}
```

El `granted` de dos estados —y no solo una lista de concesiones— es lo que permite el caso real que tenemos: dar `comentarios.gestionar` a `MARKETING` como default y **revocárselo a `pantallapdc@`**, sin inventar un rol para una pantalla y sin desactivar una cuenta cuya función no conocemos del todo (ver §12.1).

## 5. El helper `can()`

```ts
// src/lib/permissions/can.ts
export async function can(user: SessionUser, permission: Permission): Promise<boolean>
```

Orden de resolución, de mayor a menor precedencia:

1. **`ADMIN` → siempre `true`.** No consulta nada. Es el seguro contra apagones: ninguna combinación de checkboxes puede dejar la casa sin llave. (Ver §9.)
2. **Override del usuario**, si existe → devuelve su `granted`. Un `false` aquí gana sobre el rol.
3. **Default del rol** → `true` si hay fila en `role_permissions`.
4. **Nada de lo anterior → `false`.** Fail-closed: un permiso desconocido, un rol nuevo sin sembrar o una tabla vacía deniegan. Nunca hay un default permisivo.

La función pura que decide (`resolvePermission(role, override, rolePermissions)`) se separa del acceso a base para poder probar la tabla de verdad completa sin mockear Prisma — el mismo patrón que ya usan `query-scope.ts` y `nav-config.ts`.

### 5.1 Dónde se resuelve: base, no JWT

Los permisos se leen **por petición desde la base**, no se guardan en el token de NextAuth.

Meter permisos en el JWT es la trampa obvia y la razón por la que el moderador se sentiría roto: el token de NextAuth v4 sobrevive hasta que expira, así que quitarle un permiso a alguien no surtiría efecto hasta que cerrara sesión. Vas a mover un checkbox, ver que no pasa nada y pensar que el sistema falla.

Costo: una consulta extra por request que consulte permisos. Se mitiga con un caché en memoria por proceso, con TTL corto (30 s) e invalidación explícita al guardar cambios en el moderador. Un desfase de 30 s en el peor caso es aceptable; 8 horas de JWT no.

## 6. La pantalla del moderador

Nueva pestaña en `/admin?tab=permisos`, gobernada por `permisos.gestionar`.

Como ese permiso es sensible, **no se siembra a ningún rol**: al principio solo `ADMIN` abre el moderador, por su condición de comodín. Si un `DIRECTOR` debe administrarlo, un `ADMIN` se lo concede por persona y con razón escrita. Es más restrictivo que lo que hay hoy —cualquier `DIRECTOR` entra a `/admin` completo— y es a propósito: repartir permisos es la llave de todas las demás.

**Vista 1 — Matriz rol × permiso.** Filas = permisos del catálogo agrupados por módulo; columnas = roles. Checkboxes. La columna de `ADMIN` se dibuja marcada y deshabilitada, con la leyenda de que es comodín por diseño.

Los permisos sensibles aparecen en la matriz pero **con la fila entera bloqueada** y la nota "solo se concede por persona". Aparecer bloqueados y no estar ausentes es deliberado: un permiso que no se ve en ningún lado obliga a leer código para saber quién lo tiene.

**Vista 2 — Persona.** Buscas a alguien, ves sus permisos efectivos y de dónde sale cada uno ("por su rol MARKETING" / "concedido aparte" / "revocado aparte"), y puedes conceder o revocar con una razón escrita. Esta es la vista que resuelve el caso de la diseñadora, el de la pantalla, y la única por la que se concede un permiso sensible.

Guardar es explícito, no al vuelo: se acumulan los cambios y un botón los aplica, mostrando antes el resumen de qué cambia y a quién afecta.

## 7. Auditoría

Todo cambio escribe en `AuditLog` (`action: UPDATE`, `entity: "RolePermission"` o `"UserPermissionOverride"`), con `changes` = `{ permission, role|userId, antes, después, reason }`. Los permisos son justamente el tipo de cosa que alguien cambia "un segundo para probar" y olvida devolver.

## 8. Plan de adopción

La regla que hace esto seguro: **una superficie usa `can()` o usa su lista vieja de roles, nunca a medias.** Lo no migrado sigue funcionando exactamente igual. No hay ningún momento en que el sistema dependa de una migración a medio terminar.

| Fase | Qué migra | Por qué en ese orden |
|---|---|---|
| 0 | Tablas, semilla, `can()`, tests. Nadie lo usa todavía. | Se puede desplegar sin que nada cambie de comportamiento. |
| 1 | Pestañas de `/admin` + `/admin/comentarios` | Es donde está el dolor. Cierra el caso de la diseñadora *y* le quita el acceso al kiosco. |
| 2 | La pantalla del moderador | Ya hay permisos reales que administrar. |
| 3 | `nav-config` (sidebar y menú del nombre) | Lo que se ve empieza a seguir a lo que se puede. |
| 4 | Rutas `/api/admin/*` | El grupo más grande, ya con el patrón rodado. |
| 5+ | El resto, por módulo | Sin fecha. Cada uno cuando se toque por otra razón. |

La semilla de la fase 0 se genera leyendo las listas hardcodeadas actuales, y se verifica con un test que compara, rol por rol y permiso por permiso, que el resultado de `can()` coincide con lo que la lista vieja habría contestado. Ese test es la red: si la semilla se equivoca, no llega a producción.

### 8.1 Las divergencias deliberadas

Un test de paridad estricto no admite mejoras: cualquier cambio intencional lo pone en rojo, y la tentación entonces es aflojar el test — que es como se pierde la red entera.

Por eso las diferencias a propósito van en una lista explícita, con su motivo, y el test comprueba **dos cosas**: que las divergencias declaradas ocurran, y que no haya ninguna otra.

```ts
// src/lib/permissions/seed-divergences.ts
export const DIVERGENCIAS = [
  {
    role: "GERENTE",
    permission: "integraciones.gestionar",
    antes: true,
    despues: false,
    motivo:
      "Decisión de Luis (2026-08-17): un GERENTE no necesita las API keys. " +
      "Son credenciales de sistemas externos y el rol lo tienen varias personas.",
  },
] as const;
```

**Esta divergencia sí quita un acceso que hoy existe**, así que se comprobó antes de darla por buena (2026-08-17):

- Hay **un solo `GERENTE`**: Karla Muñoz (`jkarlamut@gmail.com`), alta del 2026-08-11.
- **Cero** filas en `audit_logs`, cero actividades y cero contactos asignados.

Límite de esa evidencia: `audit_logs` tiene 68 filas en dos meses y solo cubre escrituras sobre unas pocas entidades — *abrir* la pestaña de integraciones no deja rastro, así que esto no prueba que nunca la mirara. Con una sola persona en el rol y sin ninguna acción registrada, el riesgo se consideró aceptable. Si resultara equivocado, la salida no es cancelar la decisión sino un override por persona.

## 9. Seguridad

- **Fail-closed en todos lados.** Sin fila, sin rol, sin catálogo → denegado.
- **No lockout.** `ADMIN` va cableado a `true` antes de cualquier consulta. Además, un guardia en el server action impide guardar un cambio que deje `permisos.gestionar` sin ningún usuario activo que lo tenga.
- **Escalación de privilegios.** Conceder un permiso que uno mismo no tiene queda prohibido, salvo para `ADMIN`. Sin esto, `permisos.gestionar` es equivalente a `ADMIN`: quien lo tenga se autoconcede lo que quiera.
- **Permisos sensibles.** Ni default de rol, ni concesión sin razón escrita. Son los que permiten volverse otra persona (`usuarios.password`), tomar credenciales externas (`integraciones.gestionar`) o repartir permisos (`permisos.gestionar`). El guardia va en el server action, no solo en la UI.
- **El servidor es quien manda.** Ocultar un botón en el cliente es cosmética. Cada server action y cada `route.ts` migrado llama a `can()` por su cuenta.
- **El cliente nunca recibe el catálogo completo de otra persona.** Solo los permisos efectivos de quien pide, y solo para decidir qué dibujar.

## 10. Pruebas

- **Módulo puro** (`resolvePermission`): la tabla de verdad completa, incluida la precedencia override-sobre-rol en ambos sentidos y el `ADMIN` comodín.
- **Paridad con lo viejo** (fase 0): para cada rol del enum y cada permiso sembrado, `can()` responde lo mismo que la lista hardcodeada que reemplaza — **salvo** las entradas de `DIVERGENCIAS`, que deben ocurrir. Una diferencia no declarada rompe el test; una divergencia declarada que no ocurre, también.
- **Permisos sensibles**: la semilla no contiene ninguno; conceder uno sin razón escrita falla; y no existe forma de dárselo a un rol.
- **No lockout**: el guardia rechaza el cambio que dejaría a nadie con `permisos.gestionar`.
- **No escalación**: un `DIRECTOR` sin `bot.configurar` no puede concedérselo ni concedérselo a otro.
- **Por superficie migrada**: un caso que entra y uno que recibe 403, como los que ya agregó `fa5c1ef8`.
- **Caché**: tras guardar, la siguiente lectura ve el valor nuevo sin esperar el TTL.

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| La semilla se equivoca y alguien pierde acceso un lunes | El test de paridad de §8; y la fase 0 no cambia comportamiento |
| El caché sirve un permiso revocado | TTL de 30 s + invalidación explícita al guardar |
| `permisos.gestionar` se vuelve un `ADMIN` disfrazado | Regla de no escalación (§9) |
| El proyecto se queda a medias | Es el diseño: quedarse a medias es un estado válido y estable |
| La matriz crece hasta ser ilegible | Permisos agrupados por módulo; el catálogo solo suma claves cuando su fase las migra |

## 12. Decisiones tomadas

Las tres preguntas abiertas quedaron resueltas por Luis el 2026-08-17.

### 12.1 `pantallapdc@propyte.local` — se queda viva, se le revoca el permiso

Es una pantalla. En base tiene **cero eventos de auditoría y cero actividades** desde que se creó el 19 de junio, así que nunca hizo nada rastreable.

Eso **no** basta para desactivarla: una pantalla que solo muestra no deja rastro, y apagar la cuenta apagaría lo que sea que esté mostrando. La cuenta se queda activa y recibe un override `granted: false` sobre `comentarios.gestionar`. La pantalla sigue funcionando; simplemente no puede tocar las reglas.

Es el primer caso de uso real del override negativo, y confirma que la tabla necesitaba los dos estados.

### 12.2 `usuarios.password` — al moderador, marcado como sensible

El botón de restablecer contraseña (ya en producción, PR #13) migra al moderador en la fase 1, pero como permiso **sensible**: sin casilla en la matriz de roles, solo concesión por persona y con razón escrita obligatoria.

El razonamiento: quien puede restablecer contraseñas puede entrar como cualquiera, incluido el dueño del CRM. Eso no es un permiso más, y darlo con un clic a un rol entero no es lo mismo que dárselo a una persona con nombre y apellido.

Hasta que la fase 1 lo migre, la regla sigue siendo `PASSWORD_RESET_ROLES` en `src/server/admin.ts` (`ADMIN` y `DIRECTOR`), fijada por sus tests.

### 12.3 `GERENTE` pierde el acceso a las API keys

`integraciones.gestionar` no se siembra para `GERENTE`. Es la única divergencia deliberada de la semilla; queda formalizada en §8.1 con su motivo y su comprobación previa en `audit_logs`.

## 13. Lo que aún no está decidido

Nada bloquea el arranque de la fase 0. Estos son puntos a resolver cuando su fase llegue:

- **Cuántos permisos entran en el catálogo inicial.** El listado de §4.1 es ilustrativo; la lista real sale de inventariar las superficies de la fase 1.
- **Qué pasa con `MANTENIMIENTO` y `DEVELOPER_EXT`.** Son roles con presencia rara en las listas actuales; hay que mirarlos uno por uno al sembrar.
- **Si la vista de Persona debe permitir revocar un permiso a un `ADMIN`.** Hoy la respuesta es no —`ADMIN` es comodín antes de consultar nada—, pero conviene que la UI lo explique en vez de simplemente ignorar el intento.
