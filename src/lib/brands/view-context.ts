// Lecturas de la entrega 3 (2026-10-12): validar el filtro «Marca» de una lista y armar el
// contexto de badges/selector de una pantalla. La regla vive en ./filter.ts y ./badges.ts (puros).
//
// Va aparte de ./user-access.ts a propósito: las pruebas de las rutas de la entrega 2 simulan ese
// módulo con solo getVisibleBrands, y una lista sin `?marca=` no debe hacer NINGUNA consulta de
// más (loadBrandFilter no toca la base si no se pidió marca).
import prisma from "@/lib/db";
import { getVisibleBrands } from "./user-access";
import { parseBrandFilterParam, resolveBrandFilter, type BrandFilterResolution } from "./filter";
import { buildBrandViewContext, EMPTY_BRAND_VIEW, type BrandViewContext } from "./badges";
import type { VisibleBrands } from "./visibility";

/**
 * Valida la marca pedida en una lista contra lo que el usuario ve (`visible`, ya leído por la ruta).
 * Sin marca → "none" sin consultar. Marca inexistente, borrada o ajena → "invalid" (mismo
 * resultado para las tres, para no confirmar que una marca existe a quien no la ve).
 * Un error de base se propaga: no se adivina un filtro.
 */
export async function loadBrandFilter(
  requested: string | null | undefined,
  visible: VisibleBrands,
): Promise<BrandFilterResolution> {
  const parsed = parseBrandFilterParam(requested);
  if (parsed.kind !== "id") return parsed;
  const brand = await prisma.brand.findFirst({
    where: { id: parsed.brandId, deletedAt: null },
    select: { id: true, isDefault: true },
  });
  return resolveBrandFilter(parsed.brandId, brand, visible);
}

/**
 * Contexto de marcas de una pantalla (selector «Marca» + badges). Best-effort: el badge es
 * cosmético, así que si falla la lectura (o falta la migración) la pantalla sale sin badges ni
 * selector en vez de caerse. La VISIBILIDAD no depende de esto: la aplica cada consulta por su lado.
 */
export async function getBrandViewContext(user: { id: string; role: string }): Promise<BrandViewContext> {
  try {
    const [visible, brands] = await Promise.all([
      getVisibleBrands(user),
      prisma.brand.findMany({
        where: { deletedAt: null },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        select: { id: true, name: true, isDefault: true },
      }),
    ]);
    return buildBrandViewContext(brands, visible);
  } catch (err) {
    console.error("[brands] no se pudo armar el contexto de marcas de la pantalla", err);
    return EMPTY_BRAND_VIEW;
  }
}
