// Quién ve qué comisiones — los conjuntos de rol, en un solo sitio (#893).
//
// Vivían como constantes privadas de `src/server/commissions.ts`. El reporte de comisiones de
// /reports no las veía y mostraba las de toda la empresa a cualquier sesión: la misma regla
// escrita en dos sitios que divergieron. Ahora los dos módulos leen estas listas.
//
// Se movieron SIN cambiarles el valor. El orden de evaluación es FULL → PLAZA → TEAM → propias
// (ver `query-scope.ts`: ADMIN está en los tres primeros a propósito). Un rol que no esté en
// ninguna (MARKETING, MANTENIMIENTO, HOSTESS, DEVELOPER_EXT…) cae en «solo las suyas».
//
// Módulo puro: sin Prisma ni sesión.

/** Ven todas las comisiones. */
export const COMISIONES_VEN_TODAS: readonly string[] = ["ADMIN", "DIRECTOR"];
/** Ven las de los asesores de su plaza. */
export const COMISIONES_VEN_SU_PLAZA: readonly string[] = ["ADMIN", "GERENTE"];
/** Ven las de su equipo (`User.teamLeaderId`). */
export const COMISIONES_VEN_SU_EQUIPO: readonly string[] = ["ADMIN", "TEAM_LEADER"];
/** Ven solo las suyas. Es documentación: cualquier rol fuera de las tres listas de arriba cae aquí. */
export const COMISIONES_VEN_LAS_SUYAS: readonly string[] = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER"];
