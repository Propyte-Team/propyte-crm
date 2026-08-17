# Moderador de permisos por rol y por persona

**Fecha:** 2026-08-17
**Estado:** propuesta, pendiente de revisión de Luis
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
  "comentarios.gestionar": "Reglas de comentarios en redes",
  "usuarios.ver":          "Ver la lista de usuarios",
  "usuarios.editar":       "Crear y editar usuarios",
  "usuarios.password":     "Restablecer contraseñas de otros",
  "comisiones.ver":        "Ver el tablero de comisiones",
  "comisiones.reglas":     "Editar las reglas de comisión",
  "bot.configurar":        "Configuración del bot y playbooks",
  "integraciones.gestionar": "Conectores y API keys",
  "permisos.gestionar":    "Administrar este moderador de permisos",
  // …se agregan conforme cada fase migra su superficie
} as const;

export type Permission = keyof typeof PERMISSIONS;
```

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

Presencia de la fila = concedido. Se siembra con las listas que hoy están hardcodeadas, para que **el día 1 nadie gane ni pierda nada**.

### 4.3 `user_permission_overrides` — la excepción por persona

```prisma
model UserPermissionOverride {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  permission String
  granted    Boolean  // true = concede aunque su rol no lo tenga; false = revoca aunque sí
  reason     String?  // por qué; se muestra en la UI
  createdAt  DateTime @default(now())

  @@unique([userId, permission])
  @@map("user_permission_overrides")
  @@schema("propyte_crm")
}
```

El `granted` de dos estados —y no solo una lista de concesiones— es lo que permite el caso real que tenemos: dar `comentarios.gestionar` a `MARKETING` como default y **revocárselo a `pantallapdc@`**, sin inventar un rol para una pantalla.

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

Nueva pestaña en `/admin?tab=permisos`, gobernada por el permiso `permisos.gestionar` (que solo `ADMIN` y `DIRECTOR` traen sembrado).

**Vista 1 — Matriz rol × permiso.** Filas = permisos del catálogo agrupados por módulo; columnas = roles. Checkboxes. La columna de `ADMIN` se dibuja marcada y deshabilitada, con la leyenda de que es comodín por diseño.

**Vista 2 — Persona.** Buscas a alguien, ves sus permisos efectivos y de dónde sale cada uno ("por su rol MARKETING" / "concedido aparte" / "revocado aparte"), y puedes conceder o revocar con una razón escrita. Esta es la vista que resuelve el caso de la diseñadora.

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

## 9. Seguridad

- **Fail-closed en todos lados.** Sin fila, sin rol, sin catálogo → denegado.
- **No lockout.** `ADMIN` va cableado a `true` antes de cualquier consulta. Además, un guardia en el server action impide guardar un cambio que deje `permisos.gestionar` sin ningún usuario activo que lo tenga.
- **Escalación de privilegios.** Conceder un permiso que uno mismo no tiene queda prohibido, salvo para `ADMIN`. Sin esto, `permisos.gestionar` es equivalente a `ADMIN`: quien lo tenga se autoconcede lo que quiera.
- **El servidor es quien manda.** Ocultar un botón en el cliente es cosmética. Cada server action y cada `route.ts` migrado llama a `can()` por su cuenta.
- **El cliente nunca recibe el catálogo completo de otra persona.** Solo los permisos efectivos de quien pide, y solo para decidir qué dibujar.

## 10. Pruebas

- **Módulo puro** (`resolvePermission`): la tabla de verdad completa, incluida la precedencia override-sobre-rol en ambos sentidos y el `ADMIN` comodín.
- **Paridad con lo viejo** (fase 0): para cada rol del enum y cada permiso sembrado, `can()` responde lo mismo que la lista hardcodeada que reemplaza.
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

## 12. Preguntas abiertas para Luis

1. **`pantallapdc@propyte.local`** — ¿es una pantalla que nadie usa para entrar? Si es así, lo más limpio es desactivarla y ahorrarse el override. No la toco sin saber qué depende de ella.
2. **Restablecer contraseñas** — quedó pendiente de la conversación anterior. Encaja como el permiso `usuarios.password` de la fase 1. ¿Lo construyo dentro de este proyecto, o antes y por separado?
3. **`GERENTE`** — hoy entra a `/admin` completo. Al sembrar, ¿le dejamos exactamente lo que tiene, o aprovechamos para quitarle algo (por ejemplo `integraciones.gestionar`, que da acceso a las API keys)?
