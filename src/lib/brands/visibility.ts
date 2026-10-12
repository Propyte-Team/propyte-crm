// Visibilidad por marca — módulo PURO (2026-10-12, spec marcas-visibilidad, entrega 2 de 3).
//
// Regla (decisiones del dueño, 2026-10-12):
//   · ADMIN ve todas las marcas, como hoy. Cualquier otro rol (DIRECTOR incluido) ve solo las
//     marcas que tiene prendidas.
//   · Un usuario SIN filas en user_brand_access ve solo la predeterminada (Propyte). Es la misma
//     regla que contact_brands y por eso no se rellena nada: los usuarios de hoy amanecen viendo
//     solo Propyte, que es justo la decisión 3.
//   · Un contacto pertenece a las marcas de sus filas en contact_brands; SIN filas es de la
//     predeterminada (spec 2026-10-09 §2.3).
//   · Lo asignado a uno SIEMPRE se ve, sea de la marca que sea.
//
// Este filtro se SUMA (AND) al alcance por rol que ya existe (OWN/TEAM/PLAZA, alcance del inbox,
// acceso a negocios). Nunca lo reemplaza: solo puede quitar contactos, jamás agregarlos.
//
// Hay dos formas de la MISMA regla (consulta de Prisma vs. chequeo de un registro ya leído), como
// en src/lib/inbox/scope.ts. visibility.test.ts las cruza en una tabla de paridad.
import type { Prisma } from "@prisma/client";

/** Único rol que ve todas las marcas sin importar sus filas. */
export const ROLES_VEN_TODAS_LAS_MARCAS = ["ADMIN"] as const;

export function seesAllBrands(role: string | null | undefined): boolean {
  return !!role && (ROLES_VEN_TODAS_LAS_MARCAS as readonly string[]).includes(role);
}

/**
 * Marcas que ve un usuario.
 * - "ALL": no se filtra nada (ADMIN).
 * - brandIds: marcas vivas cuyos contactos (con filas) ve.
 * - includesDefault: si ve la predeterminada, también ve los contactos SIN filas (que son de ella).
 *   Va aparte de brandIds a propósito: si no se pudo leer el id de la predeterminada, un usuario
 *   sin filas sigue viendo los contactos sin filas (casi todo Propyte) en vez de quedarse en blanco.
 */
export type VisibleBrands = "ALL" | { brandIds: string[]; includesDefault: boolean };

/** Fila de user_brand_access con lo mínimo de su marca. */
export type UserBrandAccessRow = {
  brandId: string;
  brand: { isDefault: boolean; deletedAt: Date | null };
};

export function resolveVisibleBrandIds(
  user: { role: string },
  rows: readonly UserBrandAccessRow[],
  defaultBrandId: string | null,
): VisibleBrands {
  if (seesAllBrands(user.role)) return "ALL";

  // Sin filas = nadie le ha tocado los interruptores = solo la predeterminada (decisión 3).
  if (rows.length === 0) {
    return { brandIds: defaultBrandId ? [defaultBrandId] : [], includesDefault: true };
  }

  // Con filas, el conjunto es explícito: lo que el admin prendió, menos las marcas borradas.
  // Si todas sus marcas se borraron, el conjunto queda vacío (solo ve lo asignado): tener filas
  // significa que alguien ya decidió, y borrar una marca no debe devolverle Propyte en silencio.
  const vivas = rows.filter((r) => r.brand.deletedAt === null);
  const brandIds = Array.from(new Set(vivas.map((r) => r.brandId)));
  const includesDefault =
    vivas.some((r) => r.brand.isDefault) || (defaultBrandId !== null && brandIds.includes(defaultBrandId));
  return { brandIds, includesDefault };
}

/**
 * Filtro de Prisma para contactos. `undefined` = no hay que filtrar (ALL).
 * Se compone con AND junto al alcance por rol; nunca se mezcla dentro de su OR.
 */
export function contactBrandVisibilityWhere(
  user: { id: string },
  visible: VisibleBrands,
): Prisma.ContactWhereInput | undefined {
  if (visible === "ALL") return undefined;
  const or: Prisma.ContactWhereInput[] = [{ assignedToId: user.id }];
  // Sin marcas no se agrega el término: un `in: []` suelto no empareja nada y solo ensucia el SQL.
  if (visible.brandIds.length > 0) {
    or.push({ brands: { some: { brandId: { in: visible.brandIds } } } });
  }
  if (visible.includesDefault) {
    // Contacto sin filas en contact_brands = de la predeterminada (spec 2026-10-09 §2.3).
    or.push({ brands: { none: {} } });
  }
  return { OR: or };
}

/**
 * Filtro de Prisma para negocios: los asignados a mí, o los de un contacto que veo por marca.
 * El negocio no tiene marca propia; la hereda de su contacto.
 */
export function dealBrandVisibilityWhere(
  user: { id: string },
  visible: VisibleBrands,
): Prisma.DealWhereInput | undefined {
  const contactWhere = contactBrandVisibilityWhere(user, visible);
  if (!contactWhere) return undefined;
  return { OR: [{ assignedToId: user.id }, { contact: contactWhere }] };
}

/**
 * Misma regla que `contactBrandVisibilityWhere`, sobre un contacto ya leído.
 * Si el llamador no trajo `brands`, falla CERRADO: solo pasa si el contacto es suyo.
 */
export function canSeeContactBrand(
  contact: { assignedToId: string | null; brands?: ReadonlyArray<{ brandId: string }> | null },
  user: { id: string },
  visible: VisibleBrands,
): boolean {
  if (visible === "ALL") return true;
  if (contact.assignedToId === user.id) return true;
  if (!contact.brands) return false;
  if (contact.brands.length === 0) return visible.includesDefault;
  return contact.brands.some((b) => visible.brandIds.includes(b.brandId));
}

/** Misma regla que `dealBrandVisibilityWhere`, sobre un negocio ya leído con su contacto. */
export function canSeeDealBrand(
  deal: {
    assignedToId: string | null;
    contact?: { assignedToId: string | null; brands?: ReadonlyArray<{ brandId: string }> | null } | null;
  },
  user: { id: string },
  visible: VisibleBrands,
): boolean {
  if (visible === "ALL") return true;
  if (deal.assignedToId === user.id) return true;
  if (!deal.contact) return false;
  return canSeeContactBrand(deal.contact, user, visible);
}

/**
 * Select mínimo que necesita `canSeeContactBrand`. Un solo lugar para que todas las lecturas
 * de un registro traigan lo mismo y nadie olvide las marcas (sin ellas, el chequeo falla cerrado).
 */
export const CONTACT_BRAND_SELECT = { select: { brandId: true } } as const;

/**
 * Cuántos usuarios ven cada marca, con la MISMA regla que resolveVisibleBrandIds (para la tarjeta
 * de «Marcas del agente»). ADMIN cuenta en todas; sin filas cuenta solo en la predeterminada.
 */
export function countVisibleUsersByBrand(
  brands: ReadonlyArray<{ id: string; isDefault: boolean }>,
  users: ReadonlyArray<{ role: string; brandAccess: readonly UserBrandAccessRow[] }>,
): Record<string, number> {
  const defaultBrandId = brands.find((b) => b.isDefault)?.id ?? null;
  const counts: Record<string, number> = Object.fromEntries(brands.map((b) => [b.id, 0]));
  for (const u of users) {
    const visible = resolveVisibleBrandIds(u, u.brandAccess, defaultBrandId);
    for (const b of brands) {
      const ve =
        visible === "ALL" || visible.brandIds.includes(b.id) || (b.isDefault && visible.includesDefault);
      if (ve) counts[b.id] += 1;
    }
  }
  return counts;
}
