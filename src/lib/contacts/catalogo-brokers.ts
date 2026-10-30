// ============================================================
// Catálogo de brokers para «Registrado por» (#935)
// ============================================================
// Quién puede ELEGIR a un broker como «Registrado por» de un contacto. Antes era la misma puerta
// que abrir su ficha (alcance por rol), y como 338 de los 339 brokers son de Felipe o Luis
// (ADMIN), a un asesor, líder o gerente el selector le salía casi vacío. Decisión de sistemas@
// (30-oct): cualquiera que trabaja contactos ve el NOMBRE de todos los brokers para ligarlos.
// La ficha del broker sigue con su alcance de siempre: aquí solo viajan id y nombre.
//
// Lo usan el listado (GET /api/contacts/brokers) y la validación al guardar
// (errorDeReferidoPor en /api/contacts): si divergieran, el selector ofrecería brokers que el
// servidor luego rechaza, o al revés.
//
// La visibilidad por marca SÍ se respeta: un broker de una marca que el usuario no ve no aparece.

import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { CONTACT_TYPE_BROKER } from "@/lib/constants";
import { getVisibleBrands } from "@/lib/brands/user-access";
import { contactBrandVisibilityWhere } from "@/lib/brands/visibility";
import {
  FULL_ACCESS_ROLES,
  OWN_ACCESS_ROLES,
  PLAZA_ACCESS_ROLES,
  READ_ONLY_ROLES,
  TEAM_ACCESS_ROLES,
} from "./alcance-lista";

/** Brokers por página del selector. */
export const BROKERS_PAGE_SIZE = 30;

/** Los mismos roles que reconoce la lista de Contactos; un rol desconocido no ve nada. */
const ROLES_CON_CATALOGO = new Set([
  ...FULL_ACCESS_ROLES,
  ...READ_ONLY_ROLES,
  ...PLAZA_ACCESS_ROLES,
  ...TEAM_ACCESS_ROLES,
  ...OWN_ACCESS_ROLES,
]);

export function puedeVerCatalogoBrokers(role: string): boolean {
  return ROLES_CON_CATALOGO.has(role);
}

/** Palabras de la búsqueda: cada una debe aparecer en el nombre o en el apellido. */
function whereBusqueda(search: string | undefined): Prisma.ContactWhereInput[] {
  const palabras = (search ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  return palabras.map((p) => ({
    OR: [
      { firstName: { contains: p, mode: "insensitive" } },
      { lastName: { contains: p, mode: "insensitive" } },
    ],
  }));
}

/** Brokers elegibles para este usuario: vivos, de tipo Broker y de una marca que ve. */
export async function brokerCatalogWhere(
  user: { id: string; role: string },
  opts: { search?: string; excluirId?: string } = {},
): Promise<Prisma.ContactWhereInput> {
  const and: Prisma.ContactWhereInput[] = [];
  const porMarca = contactBrandVisibilityWhere(user, await getVisibleBrands(user));
  if (porMarca) and.push(porMarca);
  and.push(...whereBusqueda(opts.search));
  return {
    deletedAt: null,
    contactType: CONTACT_TYPE_BROKER,
    ...(opts.excluirId ? { id: { not: opts.excluirId } } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

/**
 * ¿Puede este usuario ligar al broker `brokerId`? Devuelve lo que `validarReferidoPor` necesita:
 * el broker si es un CONTACTO vivo que el usuario puede elegir (con su tipo, para distinguir «no
 * es broker»), o null si no existe, está borrado o es de una marca que no ve — el mismo null en
 * los tres casos, para no confirmar que existe.
 */
export async function brokerElegible(
  user: { id: string; role: string },
  brokerId: string,
): Promise<{ id: string; contactType: string | null } | null> {
  if (!puedeVerCatalogoBrokers(user.role)) return null;
  const where: Prisma.ContactWhereInput = { id: brokerId, deletedAt: null };
  const porMarca = contactBrandVisibilityWhere(user, await getVisibleBrands(user));
  if (porMarca) where.AND = [porMarca];
  return prisma.contact.findFirst({ where, select: { id: true, contactType: true } });
}
