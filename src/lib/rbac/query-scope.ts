// Alcance RBAC de una consulta por usuario. Módulo puro: sin Prisma, sin sesión.
//
// Existe porque el mismo par de bugs aparecía copiado en varias rutas:
//
//  1. **Orden invertido.** Los sets no son disjuntos: `ADMIN` está en `full` Y en
//     `team`. Evaluar TEAM antes que FULL deja a todo ADMIN viendo únicamente su
//     equipo. Orden canónico = FULL → TEAM → OWN → denegado.
//
//  2. **`?userId=` sin validar.** Varias rutas calculaban el filtro por rol y
//     después lo SOBREESCRIBÍAN con el `userId` del query string, así que un
//     ASESOR podía leer los datos de cualquier otro pasando su id. Aquí el id
//     pedido se INTERSECTA con el alcance en vez de reemplazarlo.
//
// Los sets de roles siguen viviendo en cada módulo: no son iguales (comisiones
// incluye GERENTE en `full`, contactos tiene un nivel PLAZA aparte), y
// unificarlos aquí cambiaría permisos en silencio. Lo que se comparte es el
// ORDEN y la regla de intersección, que es donde estaban los fallos.

export type ScopeBucket = "ALL" | "TEAM" | "OWN" | "DENIED";

export interface RoleSets {
  full: readonly string[];
  team: readonly string[];
  own: readonly string[];
  /** Roles que ven todo sin estar en `full` (ej. MARKETING en actividades). */
  alsoAll?: readonly string[];
}

export function resolveScopeBucket(role: string, sets: RoleSets): ScopeBucket {
  if (sets.full.includes(role) || (sets.alsoAll ?? []).includes(role)) return "ALL";
  if (sets.team.includes(role)) return "TEAM";
  if (sets.own.includes(role)) return "OWN";
  return "DENIED";
}

/**
 * ¿Puede este alcance leer los datos de `requestedUserId`?
 *
 * `allowedIds` son los ids que el bucket habilita (uno mismo, o uno mismo + su
 * equipo). Se ignora cuando el bucket es ALL.
 *
 * Devolver false debe traducirse en 403, no en una lista vacía: una lista vacía
 * se lee como "no hay datos" y esconde el intento.
 */
export function canReadUserScope(
  bucket: ScopeBucket,
  allowedIds: readonly string[],
  requestedUserId: string,
): boolean {
  if (bucket === "ALL") return true;
  if (bucket === "DENIED") return false;
  return allowedIds.includes(requestedUserId);
}
