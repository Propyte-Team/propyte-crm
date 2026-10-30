// ============================================================
// «Detalle de la fuente»: catálogo de campañas y eventos (#937) — lado servidor
// ============================================================
// El contacto apunta a una campaña o evento con Contact.campaignId. `leadSourceDetail` NO se usa
// para esto: lo escriben las entradas automáticas («comentario:<id>» de Meta, que leen el bot y el
// conteo de leads reales; «Facebook Ads»/«Self-Gen» de la importación) y se queda como estaba.

import { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import {
  CAMPANA_MAX,
  claveCatalogo,
  esTipoCampana,
  limpiarNombre,
  type OpcionCatalogo,
} from "@/lib/catalogos/clave";
import type { ResultadoAlta } from "./etiquetas";

export interface CampanaOpcion extends OpcionCatalogo {
  kind: string;
}

/** Campañas y eventos elegibles (sin archivar), por nombre. */
export async function listarCampanas(): Promise<CampanaOpcion[]> {
  return prisma.leadCampaign.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true, kind: true },
    orderBy: { name: "asc" },
  });
}

/**
 * ¿Se puede ligar el contacto a `campaignId`? Tiene que existir y no estar archivada; la que el
 * contacto ya tiene se acepta aunque se haya archivado (guardar otro campo no debe fallar).
 */
export async function errorDeCampana(campaignId: string, actual: string | null = null): Promise<string | null> {
  if (campaignId === actual) return null;
  const c = await prisma.leadCampaign.findFirst({
    where: { id: campaignId, archivedAt: null },
    select: { id: true },
  });
  return c ? null : "La campaña o evento elegido no existe";
}

/** «Crear +»: da de alta la campaña/evento, o devuelve la que ya existe con el mismo nombre. */
export async function crearCampana(
  nombre: string,
  kind: unknown,
  userId: string,
): Promise<ResultadoAlta<CampanaOpcion>> {
  const name = limpiarNombre(nombre);
  if (!name) return { ok: false, error: "Escribe el nombre de la campaña o evento" };
  if (name.length > CAMPANA_MAX) return { ok: false, error: `Máximo ${CAMPANA_MAX} caracteres` };
  if (!esTipoCampana(kind)) return { ok: false, error: "Elige si es campaña o evento" };
  const nameKey = claveCatalogo(name);

  const existente = await prisma.leadCampaign.findUnique({ where: { nameKey } });
  if (existente) {
    if (existente.archivedAt) {
      await prisma.leadCampaign.update({ where: { id: existente.id }, data: { archivedAt: null } });
    }
    return { ok: true, creada: false, data: { id: existente.id, name: existente.name, kind: existente.kind } };
  }
  try {
    const nueva = await prisma.leadCampaign.create({ data: { name, nameKey, kind, createdById: userId } });
    return { ok: true, creada: true, data: { id: nueva.id, name: nueva.name, kind: nueva.kind } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const ganadora = await prisma.leadCampaign.findUnique({ where: { nameKey } });
      if (ganadora) return { ok: true, creada: false, data: { id: ganadora.id, name: ganadora.name, kind: ganadora.kind } };
    }
    throw e;
  }
}
