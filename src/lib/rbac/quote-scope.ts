// ============================================================
// Cotizaciones: quién ve qué y quién puede modificarlas (#867)
// ============================================================
// La pantalla /cotizaciones cargaba `quote.findMany({ where: { deletedAt: null } })` sin
// mirar quién preguntaba: cualquier cuenta veía clientes, desarrollos, precios y descuentos
// de toda la empresa. Y nadie distinguía «ver» de «modificar» por rol en este módulo.
//
// La matriz (definida por sistemas@ el 2026-10-14):
//
//   rol            ve en la lista                              modifica
//   ─────────────  ──────────────────────────────────────────  ─────────
//   ADMIN          todas                                       sí
//   DIRECTOR       todas (dentro de sus marcas)                NO
//   MARKETING      todas (dentro de sus marcas)                NO (por ahora)
//   GERENTE        las suyas + las de negocios de su plaza     sí
//   TEAM_LEADER    las suyas + las de negocios de su equipo    sí
//   asesores, BROKER y cualquier otro rol
//                  solo las suyas: las que emitió o las de     sí, las suyas
//                  un negocio que tiene asignado
//
// «Su equipo» = los asesores cuyo `teamLeaderId` es el TL. Puede haber varios equipos en la
// misma plaza y un TL no ve los de los demás. Es el mismo criterio que ya usa el detalle
// (`deal-access.ts`), así que lo que sale en la lista también se puede abrir.
//
// Un rol que nadie haya contemplado cae en «solo las suyas», nunca en «todas».
//
// Módulo puro: sin Prisma en tiempo de ejecución ni sesión, para probarlo rol por rol.

import type { Prisma, Plaza } from "@prisma/client";
import { dealBrandVisibilityWhere, type VisibleBrands } from "@/lib/brands/visibility";

/** Ven todas las cotizaciones sin ningún filtro (ni de marca). */
export const COTIZACIONES_SIN_FILTRO: readonly string[] = ["ADMIN"];
/** Ven todas las de la empresa, limitadas por las marcas que ven. */
export const COTIZACIONES_VEN_TODAS: readonly string[] = ["DIRECTOR", "MARKETING"];
/** Ven las de los negocios de su plaza. */
export const COTIZACIONES_VEN_SU_PLAZA: readonly string[] = ["GERENTE"];
/** Ven las de los negocios de los asesores de su equipo. */
export const COTIZACIONES_VEN_SU_EQUIPO: readonly string[] = ["TEAM_LEADER"];
/**
 * Pueden ver, pero no crear, editar, enviar, borrar, armar planes ni registrar pagos.
 * DEVELOPER_EXT ya era de solo lectura en `deal-access.ts`; se repite aquí para que este
 * módulo no dependa de que esa lista no cambie.
 */
export const COTIZACIONES_SOLO_LECTURA: readonly string[] = ["DIRECTOR", "MARKETING", "DEVELOPER_EXT"];

/** Mensaje único para el rechazo por solo lectura. Las rutas lo traducen a 403. */
export const SOLO_LECTURA_COTIZACIONES = "Tu rol puede ver cotizaciones, pero no modificarlas";

export interface UsuarioParaCotizaciones {
  id: string;
  role: string;
  plaza?: string | null;
}

/** ¿Este rol puede crear o modificar cotizaciones (las que su alcance le deja ver)? */
export function puedeModificarCotizaciones(role: string): boolean {
  return !COTIZACIONES_SOLO_LECTURA.includes(role);
}

/**
 * Filtro de Prisma para LISTAR cotizaciones. Se compone con AND junto al resto del `where`.
 * `{}` = sin restricción (solo ADMIN).
 */
export function alcanceCotizaciones(
  user: UsuarioParaCotizaciones,
  marcas: VisibleBrands,
): Prisma.QuoteWhereInput {
  if (COTIZACIONES_SIN_FILTRO.includes(user.role)) return {};

  const propias: Prisma.QuoteWhereInput[] = [
    { createdById: user.id },
    { deal: { assignedToId: user.id } },
  ];

  let ampliacion: Prisma.QuoteWhereInput | null = null;
  if (COTIZACIONES_VEN_TODAS.includes(user.role)) {
    ampliacion = {};
  } else if (COTIZACIONES_VEN_SU_PLAZA.includes(user.role) && user.plaza) {
    // Sin plaza no hay «su plaza»: se queda en las propias en vez de ampliar a ciegas.
    ampliacion = { deal: { assignedTo: { plaza: user.plaza as Plaza } } };
  } else if (COTIZACIONES_VEN_SU_EQUIPO.includes(user.role)) {
    ampliacion = { deal: { assignedTo: { teamLeaderId: user.id } } };
  }

  if (!ampliacion) return { OR: propias };

  // La ampliación respeta las marcas que ve la persona; lo propio no se esconde por marca.
  const porMarca = dealBrandVisibilityWhere(user, marcas);
  const ampliada = porMarca ? { AND: [ampliacion, { deal: porMarca }] } : ampliacion;
  return { OR: [...propias, ampliada] };
}
