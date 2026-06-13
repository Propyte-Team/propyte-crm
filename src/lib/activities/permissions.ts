// Roles que solo pueden tocar sus propias actividades.
const OWN_ACCESS_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "HOSTESS"]

/**
 * ¿Puede `userRole` modificar o borrar una actividad?
 * `isOwner` = la actividad pertenece al usuario actual.
 * Roles "own" solo tocan lo propio; el resto (equipo/full) sí — la
 * visibilidad por equipo ya la restringe getActivities() al listar.
 */
export function canModifyActivity(userRole: string, isOwner: boolean): boolean {
  if (OWN_ACCESS_ROLES.includes(userRole)) return isOwner
  return true
}
