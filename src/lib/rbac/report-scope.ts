// ============================================================
// Reportes: quién entra y qué cifras ve (#893)
// ============================================================
// Antes la página /reports y sus siete consultas solo pedían sesión. El menú ocultaba Reportes
// a los asesores, pero la URL y las consultas respondían a cualquier rol: un asesor veía las
// comisiones de todos. Tampoco había alcance por rol: GERENTE y TEAM_LEADER veían la empresa
// entera.
//
// Dos preguntas, dos reglas:
//
// 1. ¿Quién entra? Los mismos roles que ven «Reportes» en el menú, más ADMIN. `nav-config.ts`
//    importa ESTA lista: el menú y la puerta no pueden separarse.
//
// 2. ¿Qué cifras ve? La matriz de roles de la #869 (la misma de Cotizaciones, #867):
//
//      rol            ve
//      ─────────────  ──────────────────────────────────────────────────────────
//      ADMIN          todo (sin recorte de marca)
//      DIRECTOR       todo, dentro de sus marcas
//      MARKETING      todo, dentro de sus marcas
//      GERENTE        lo suyo + lo de los asesores de su plaza
//      TEAM_LEADER    lo suyo + lo de su equipo (`User.teamLeaderId`)
//      cualquier otro solo lo suyo
//
//    Comisiones es la excepción: usa los conjuntos del módulo Comisiones
//    (`commission-scope.ts`), así /reports no enseña comisiones que /commissions esconde.
//    MARKETING, que no tiene Comisiones en el menú, ve en ese reporte solo las suyas.
//
// «Lo suyo» depende del dato: el negocio o el contacto asignado a la persona, la actividad que
// registró ella. Un rol que nadie haya contemplado cae en «solo lo suyo», nunca en «todo».
// Hoy eso incluye a MANTENIMIENTO: entra (está en el menú), pero ve solo lo suyo.
//
// El recorte por marca (`lib/brands/visibility.ts`) se SUMA con AND. Nunca lo reemplaza.
//
// Módulo puro: sin Prisma en tiempo de ejecución ni sesión, para probarlo rol por rol.

import type { Prisma, Plaza } from "@prisma/client";
import {
  COMISIONES_VEN_TODAS,
  COMISIONES_VEN_SU_PLAZA,
  COMISIONES_VEN_SU_EQUIPO,
} from "./commission-scope";

/** Roles que ven «Reportes» en el menú y pueden abrirlo. ADMIN entra siempre. */
export const REPORTES_ROLES: readonly string[] = [
  "DIRECTOR",
  "GERENTE",
  "TEAM_LEADER",
  "MARKETING",
  "MANTENIMIENTO",
];

/** Ven las cifras de toda la empresa (DIRECTOR y MARKETING, dentro de sus marcas). */
export const REPORTES_VEN_TODO: readonly string[] = ["ADMIN", "DIRECTOR", "MARKETING"];
/** Ven lo suyo + lo de los asesores de su plaza. */
export const REPORTES_VEN_SU_PLAZA: readonly string[] = ["GERENTE"];
/** Ven lo suyo + lo de su equipo. */
export const REPORTES_VEN_SU_EQUIPO: readonly string[] = ["TEAM_LEADER"];

/** Mensaje único de rechazo. Es el mismo que ya lanzaban las consultas sin sesión. */
export const SIN_ACCESO_REPORTES = "No autorizado";

export interface UsuarioParaReportes {
  id: string;
  role: string;
  plaza?: string | null;
}

export function puedeVerReportes(role: string | null | undefined): boolean {
  return !!role && (role === "ADMIN" || REPORTES_ROLES.includes(role));
}

export type NivelReportes = "TODO" | "PLAZA" | "EQUIPO" | "PROPIO";

function nivel(
  user: UsuarioParaReportes,
  todo: readonly string[],
  plaza: readonly string[],
  equipo: readonly string[],
): NivelReportes {
  if (todo.includes(user.role)) return "TODO";
  // Sin plaza no hay «su plaza»: se queda en lo propio en vez de ampliar a ciegas.
  if (plaza.includes(user.role)) return user.plaza ? "PLAZA" : "PROPIO";
  if (equipo.includes(user.role)) return "EQUIPO";
  return "PROPIO";
}

/** Nivel de alcance para los reportes, salvo el de comisiones. */
export function nivelReportes(user: UsuarioParaReportes): NivelReportes {
  return nivel(user, REPORTES_VEN_TODO, REPORTES_VEN_SU_PLAZA, REPORTES_VEN_SU_EQUIPO);
}

/** Nivel de alcance para el reporte de comisiones: el mismo que el módulo Comisiones. */
export function nivelComisiones(user: UsuarioParaReportes): NivelReportes {
  return nivel(user, COMISIONES_VEN_TODAS, COMISIONES_VEN_SU_PLAZA, COMISIONES_VEN_SU_EQUIPO);
}

/**
 * Arma el filtro de un nivel con las tres formas que tiene cada modelo de decir «lo suyo»,
 * «su plaza» y «su equipo». `undefined` = sin restricción. Se compone con AND.
 */
function porNivel<W>(
  n: NivelReportes,
  user: UsuarioParaReportes,
  propio: W,
  dePlaza: (plaza: Plaza) => W,
  deEquipo: W,
): W | undefined {
  if (n === "TODO") return undefined;
  if (n === "PLAZA") return { OR: [propio, dePlaza(user.plaza as Plaza)] } as W;
  if (n === "EQUIPO") return { OR: [propio, deEquipo] } as W;
  return propio;
}

/** Negocios: por el asesor asignado. */
export function alcanceNegociosReporte(
  user: UsuarioParaReportes,
  n: NivelReportes = nivelReportes(user),
): Prisma.DealWhereInput | undefined {
  return porNivel<Prisma.DealWhereInput>(
    n,
    user,
    { assignedToId: user.id },
    (plaza) => ({ assignedTo: { plaza } }),
    { assignedTo: { teamLeaderId: user.id } },
  );
}

/** Contactos: por el asesor asignado. Un contacto sin asesor solo entra con nivel TODO. */
export function alcanceContactosReporte(
  user: UsuarioParaReportes,
  n: NivelReportes = nivelReportes(user),
): Prisma.ContactWhereInput | undefined {
  return porNivel<Prisma.ContactWhereInput>(
    n,
    user,
    { assignedToId: user.id },
    (plaza) => ({ assignedTo: { is: { plaza } } }),
    { assignedTo: { is: { teamLeaderId: user.id } } },
  );
}

/** Actividades: por quien la registró. */
export function alcanceActividadesReporte(
  user: UsuarioParaReportes,
  n: NivelReportes = nivelReportes(user),
): Prisma.ActivityWhereInput | undefined {
  return porNivel<Prisma.ActivityWhereInput>(
    n,
    user,
    { userId: user.id },
    (plaza) => ({ user: { plaza } }),
    { user: { teamLeaderId: user.id } },
  );
}

/** Negocios del reporte de comisiones: la regla del módulo Comisiones. */
export function alcanceComisionesReporte(user: UsuarioParaReportes): Prisma.DealWhereInput | undefined {
  return alcanceNegociosReporte(user, nivelComisiones(user));
}
