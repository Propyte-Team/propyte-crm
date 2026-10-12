// Carga las marcas que ve un usuario (2026-10-12, spec marcas-visibilidad).
// La decisión vive en ./visibility.ts (puro); aquí solo se lee la base.
//
// Es un módulo aparte para que cada ruta lo pueda simular en sus pruebas sin arrastrar el
// cliente de Prisma, y para que haya UN solo lugar que decida qué pasa si la lectura falla.
import prisma from "@/lib/db";
import { getDefaultBrandId } from "./resolve";
import { resolveVisibleBrandIds, seesAllBrands, type VisibleBrands } from "./visibility";

/** P2021 = la tabla no existe: la migración 2026-10-12-user-brand-access.sql aún no se aplicó. */
function isMissingTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2021";
}

/**
 * Marcas que ve el usuario de la sesión.
 *
 * - ADMIN → "ALL" sin consultar nada.
 * - Tabla inexistente → se trata como "sin filas" = solo la predeterminada. Es el estado inicial
 *   que decidió el dueño (decisión 3), así que desplegar antes de migrar no abre nada.
 * - Cualquier otro error SE PROPAGA. No se puede "fallar cerrado" a la predeterminada: a quien le
 *   apagaron Propyte, eso le mostraría Propyte. Un 500 es mejor que ver lo que no toca.
 */
export async function getVisibleBrands(user: { id: string; role: string }): Promise<VisibleBrands> {
  if (seesAllBrands(user.role)) return "ALL";

  let rows: Array<{ brandId: string; brand: { isDefault: boolean; deletedAt: Date | null } }>;
  try {
    rows = await prisma.userBrandAccess.findMany({
      where: { userId: user.id },
      select: { brandId: true, brand: { select: { isDefault: true, deletedAt: true } } },
    });
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    rows = [];
  }

  // El id de la predeterminada solo hace falta para quien no tiene filas: con filas, la
  // predeterminada se reconoce por brand.isDefault en la misma consulta.
  const defaultBrandId = rows.length === 0 ? await getDefaultBrandId() : null;
  return resolveVisibleBrandIds(user, rows, defaultBrandId);
}

export type UserBrandAccessOverview = {
  /** Marcas vivas, la predeterminada primero. */
  brands: Array<{ id: string; name: string; isDefault: boolean }>;
  /**
   * Filas explícitas por usuario, solo de marcas vivas. Un usuario AUSENTE no tiene filas (ve solo
   * la predeterminada); uno con `[]` tiene filas pero todas de marcas borradas (ve solo lo suyo).
   */
  explicitByUser: Record<string, string[]>;
};

/**
 * Datos de «Marcas que ve» para Configuración → Usuarios & Roles. Best-effort: si falta la
 * migración o la lectura falla, devuelve null y la pantalla lo dice en vez de tumbar /admin.
 */
export async function getUserBrandAccessOverview(): Promise<UserBrandAccessOverview | null> {
  try {
    const [brands, rows] = await Promise.all([
      prisma.brand.findMany({
        where: { deletedAt: null },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        select: { id: true, name: true, isDefault: true },
      }),
      prisma.userBrandAccess.findMany({
        select: { userId: true, brandId: true, brand: { select: { deletedAt: true } } },
      }),
    ]);
    const explicitByUser: Record<string, string[]> = {};
    for (const r of rows) {
      const ids = (explicitByUser[r.userId] ??= []);
      if (r.brand.deletedAt === null) ids.push(r.brandId);
    }
    return { brands, explicitByUser };
  } catch (err) {
    if (!isMissingTable(err)) console.error("[brands] no se pudieron leer las marcas por usuario", err);
    return null;
  }
}
