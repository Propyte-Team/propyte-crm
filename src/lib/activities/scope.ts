// ============================================================
// Alcance RBAC de las consultas de actividades
// ============================================================
// Módulo aparte (y sin imports de Prisma ni de la sesión) para que el bucket
// de cada rol se pueda testear en aislamiento: el bug que motivó esto vivía
// exactamente en esta decisión, no en la query.

// Roles con acceso total
const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"]
// Roles con acceso a su equipo
const TEAM_ACCESS_ROLES = ["ADMIN", "TEAM_LEADER"]
// Roles con acceso solo a lo propio
const OWN_ACCESS_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "HOSTESS"]
// No está en ningún set, pero históricamente ve todo. Explícito > `else`.
const ALL_ACCESS_EXTRA = ["MARKETING"]

export type ActivityScope = "ALL" | "TEAM" | "OWN" | "DENIED"

/**
 * Decide qué actividades puede ver un rol.
 *
 * **El orden de los `if` es la corrección, no un detalle de estilo.** `ADMIN`
 * pertenece a `FULL_ACCESS_ROLES` *y* a `TEAM_ACCESS_ROLES`; mientras se evaluó
 * OWN → TEAM → FULL, todo ADMIN caía en la rama TEAM y veía únicamente las
 * actividades de su propio equipo (afectaba `getActivities` y
 * `getOverdueTasks`, y por lo tanto el dashboard).
 *
 * Orden canónico = FULL → TEAM → OWN → denegado. Es el mismo que ya usaban
 * `buildRbacFilter` (server/contacts.ts), server/deals.ts y server/walk-ins.ts;
 * activities.ts era el único módulo que lo tenía invertido.
 */
export function resolveActivityScope(userRole: string): ActivityScope {
  if (FULL_ACCESS_ROLES.includes(userRole) || ALL_ACCESS_EXTRA.includes(userRole)) return "ALL"
  if (TEAM_ACCESS_ROLES.includes(userRole)) return "TEAM"
  if (OWN_ACCESS_ROLES.includes(userRole)) return "OWN"
  return "DENIED"
}
