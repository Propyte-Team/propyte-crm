// ============================================================
// Metas: quién ve y quién fija qué (#895)
// ============================================================
// Antes, el scorecard solo forzaba `userId = yo` a los roles de asesor. TEAM_LEADER, GERENTE y
// MARKETING pedían `?userId=` o `?teamId=` de quien fuera y veían sus metas y su avance. Y el
// alta y el borrado solo miraban el rol: GERENTE y TEAM_LEADER fijaban metas a cualquiera,
// también las de la EMPRESA, y borraban cualquier meta por id.
//
// Regla que definió sistemas@ el 2026-10-16:
//
//      rol            ve                                          fija / borra
//      ─────────────  ──────────────────────────────────────────  ─────────────────────────────
//      ADMIN          todas                                       todas, incluida la empresa
//      DIRECTOR       todas                                       todas, incluida la empresa
//      GERENTE        empresa + personas y equipos de su plaza    personas y equipos de su plaza
//      TEAM_LEADER    empresa + él, su equipo y los equipos que   él, su equipo y los equipos
//                     encabeza                                    que encabeza
//      cualquier otro empresa + las suyas                         nada
//
// «Su equipo» = los usuarios cuyo `teamLeaderId` es el TL, igual que Cotizaciones (#867) y
// Reportes (#893). Las metas de EQUIPO usan el modelo `Team`: el TL ve las de los equipos donde
// es `leaderId`, y el gerente las de los equipos de su plaza.
//
// MARKETING, HOSTESS, MANTENIMIENTO y DEVELOPER_EXT caen en «cualquier otro» por decisión
// explícita. Un rol que nadie haya contemplado también cae ahí, nunca en «todo».
// Un GERENTE sin plaza tampoco amplía a ciegas: se queda en lo propio.
//
// Módulo puro: sin Prisma en tiempo de ejecución ni sesión, para probarlo rol por rol.

import type { Prisma, Plaza } from "@prisma/client";

export const GOAL_SCOPES = ["USER", "TEAM", "COMPANY"] as const;
export type GoalScopeValue = (typeof GOAL_SCOPES)[number];

/** GoalMetric en prisma/schema.prisma. */
export const GOAL_METRICS = [
  "CAPTACIONES",
  "NEGOCIOS_CREADOS",
  "COTIZACIONES_ENVIADAS",
  "ACTIVIDADES_COMPLETADAS",
  "NEGOCIOS_GANADOS",
  "MONTO_VENTA",
] as const;
export type GoalMetricValue = (typeof GOAL_METRICS)[number];

/** Pueden fijar y borrar metas de personas y equipos (dentro de su alcance). */
export const METAS_FIJAN: readonly string[] = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"];
/** Pueden fijar y borrar las metas generales de la empresa. */
export const METAS_EMPRESA_FIJAN: readonly string[] = ["ADMIN", "DIRECTOR"];

const VEN_TODO: readonly string[] = ["ADMIN", "DIRECTOR"];
const VEN_SU_PLAZA: readonly string[] = ["GERENTE"];
const VEN_SU_EQUIPO: readonly string[] = ["TEAM_LEADER"];

export interface UsuarioParaMetas {
  id: string;
  role: string;
  plaza?: string | null;
}

export type NivelMetas = "TODO" | "PLAZA" | "EQUIPO" | "PROPIO";

export function nivelMetas(user: UsuarioParaMetas): NivelMetas {
  if (VEN_TODO.includes(user.role)) return "TODO";
  if (VEN_SU_PLAZA.includes(user.role)) return user.plaza ? "PLAZA" : "PROPIO";
  if (VEN_SU_EQUIPO.includes(user.role)) return "EQUIPO";
  return "PROPIO";
}

export function puedeFijarMetas(role: string | null | undefined): boolean {
  return !!role && METAS_FIJAN.includes(role);
}

export function puedeFijarMetasEmpresa(role: string | null | undefined): boolean {
  return !!role && METAS_EMPRESA_FIJAN.includes(role);
}

/** Personas cuyas metas ve (y, si fija metas, fija). `undefined` = cualquiera. */
export function personasDeMetas(user: UsuarioParaMetas): Prisma.UserWhereInput | undefined {
  const n = nivelMetas(user);
  if (n === "TODO") return undefined;
  if (n === "PLAZA") return { plaza: user.plaza as Plaza };
  if (n === "EQUIPO") return { OR: [{ id: user.id }, { teamLeaderId: user.id }] };
  return { id: user.id };
}

/** Equipos cuyas metas ve (y fija). `undefined` = cualquiera; `null` = ninguno. */
export function equiposDeMetas(user: UsuarioParaMetas): Prisma.TeamWhereInput | undefined | null {
  const n = nivelMetas(user);
  if (n === "TODO") return undefined;
  if (n === "PLAZA") return { plaza: user.plaza as Plaza };
  if (n === "EQUIPO") return { leaderId: user.id };
  return null;
}

/** Metas que el usuario puede ver. `undefined` = todas. Se compone con AND. */
export function metasVisiblesWhere(user: UsuarioParaMetas): Prisma.GoalWhereInput | undefined {
  if (nivelMetas(user) === "TODO") return undefined;
  const equipos = equiposDeMetas(user);
  return {
    OR: [
      { scope: "COMPANY" },
      { scope: "USER", user: personasDeMetas(user) },
      ...(equipos ? [{ scope: "TEAM" as const, team: equipos }] : []),
    ],
  };
}

/**
 * Lo que pide el scorecard. Sin filtros es «mi avance»: mis metas + las de la empresa (lo
 * usan el widget de Hoy y la pantalla de Metas al abrir). Con filtros, se suman con AND.
 * Nunca amplía: el alcance del rol va aparte y también en AND.
 */
export function filtroScorecard(
  user: UsuarioParaMetas,
  params: { scope?: string | null; userId?: string | null; teamId?: string | null },
): { error: string } | { where: Prisma.GoalWhereInput } {
  const { scope, userId, teamId } = params;
  if (scope && !(GOAL_SCOPES as readonly string[]).includes(scope)) {
    return { error: "scope inválido (USER | TEAM | COMPANY)" };
  }
  if (!scope && !userId && !teamId) {
    return { where: { OR: [{ scope: "COMPANY" }, { scope: "USER", userId: user.id }] } };
  }
  const y: Prisma.GoalWhereInput[] = [];
  if (scope) y.push({ scope: scope as GoalScopeValue });
  if (userId) y.push({ scope: "USER", userId });
  if (teamId) y.push({ scope: "TEAM", teamId });
  return { where: y.length === 1 ? y[0] : { AND: y } };
}
