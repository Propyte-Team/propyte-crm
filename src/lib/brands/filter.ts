// Filtro «Marca» de las listas — módulo PURO (2026-10-12, entrega 3 de 3, spec marcas-filtros-reportes §3).
//
// Decisión del dueño: Contactos, Bandeja y Negocios tienen un selector «Marca» con «Todas mis
// marcas» (por omisión) más cada marca que el usuario ve. El filtro solo ACOTA dentro de lo que
// ya permite la visibilidad de la entrega 2 (visibility.ts): se suma con AND y jamás la sustituye.
//
// Por eso hay dos piezas separadas:
//   · resolveBrandFilter decide si la marca pedida se puede usar. Una marca que el usuario no ve
//     se trata EXACTAMENTE igual que una que no existe (`invalid`): si se distinguieran, la
//     respuesta confirmaría que la marca existe a quien no la tiene prendida.
//   · los *BrandFilterWhere devuelven solo el recorte por pertenencia. No traen el término
//     «asignado a mí» de la visibilidad: elegir Yaxnáh significa «los de Yaxnáh», no «los de
//     Yaxnáh más todos los míos». Lo mío ya entra por la visibilidad, que va en el mismo AND.
import type { Prisma } from "@prisma/client";
import type { VisibleBrands } from "./visibility";

/** Nombre del parámetro en la URL y en las APIs de lista: `?marca=<brandId>`. */
export const BRAND_FILTER_PARAM = "marca";

/** Marca elegida y ya validada contra lo que el usuario ve. */
export type BrandFilter = { brandId: string; isDefault: boolean };

export type BrandFilterResolution =
  | { kind: "none" }
  | { kind: "brand"; filter: BrandFilter }
  | { kind: "invalid" };

// Los ids de marca son uuid; se acepta cualquier id "con forma de id" (letras, números, guiones)
// para no atar el filtro al formato, pero se rechaza la basura antes de ir a la base.
const BRAND_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** Lee el parámetro crudo. Vacío = sin filtro; con forma rara = inválido sin consultar nada. */
export function parseBrandFilterParam(
  raw: string | null | undefined,
): { kind: "none" } | { kind: "id"; brandId: string } | { kind: "invalid" } {
  const value = raw?.trim() ?? "";
  if (!value) return { kind: "none" };
  if (!BRAND_ID_RE.test(value)) return { kind: "invalid" };
  return { kind: "id", brandId: value };
}

/**
 * ¿Se puede filtrar por esta marca?
 * @param brand la marca VIVA leída de la base para `requested`, o null si no existe o está borrada.
 */
export function resolveBrandFilter(
  requested: string | null | undefined,
  brand: { id: string; isDefault: boolean } | null,
  visible: VisibleBrands,
): BrandFilterResolution {
  const parsed = parseBrandFilterParam(requested);
  if (parsed.kind !== "id") return parsed;
  if (!brand || brand.id !== parsed.brandId) return { kind: "invalid" };

  const filter: BrandFilter = { brandId: brand.id, isDefault: brand.isDefault };
  if (visible === "ALL") return { kind: "brand", filter };
  // La predeterminada se reconoce también por includesDefault: si no se pudo leer su id, un
  // usuario sin filas la ve igual (visibility.ts) y debe poder elegirla.
  const loVe = visible.brandIds.includes(brand.id) || (brand.isDefault && visible.includesDefault);
  return loVe ? { kind: "brand", filter } : { kind: "invalid" };
}

/**
 * Contactos de la marca elegida. Regla de pertenencia de la entrega 1 (§2.3): un contacto SIN
 * filas en contact_brands es de la predeterminada, así que filtrar por ella también los incluye.
 */
export function contactBrandFilterWhere(filter: BrandFilter): Prisma.ContactWhereInput {
  const conFila: Prisma.ContactWhereInput = { brands: { some: { brandId: filter.brandId } } };
  if (!filter.isDefault) return conFila;
  return { OR: [{ brands: { none: {} } }, conFila] };
}

/** Negocios de la marca elegida: el negocio no tiene marca propia, la hereda de su contacto. */
export function dealBrandFilterWhere(filter: BrandFilter): Prisma.DealWhereInput {
  return { contact: contactBrandFilterWhere(filter) };
}

/**
 * Conversaciones de la marca elegida, por la marca de la CUENTA del hilo (lead_connectors.brandId)
 * y no por las del contacto. Un contacto de Propyte que también le escribió a Yaxnáh tiene dos
 * hilos; filtrar la bandeja por Yaxnáh debe dejar el de Yaxnáh y no el otro. Es la misma marca que
 * usa el agente para contestar (resolve.ts) y la que pinta el badge del hilo.
 *
 * Sin cuenta o con cuenta sin marca = predeterminada (resolveBrandForConnector → "default").
 */
export function conversationBrandFilterWhere(filter: BrandFilter): Prisma.ConversationWhereInput {
  if (!filter.isDefault) return { connector: { is: { brandId: filter.brandId } } };
  return {
    OR: [
      { connectorId: null },
      { connector: { is: { brandId: null } } },
      { connector: { is: { brandId: filter.brandId } } },
    ],
  };
}
