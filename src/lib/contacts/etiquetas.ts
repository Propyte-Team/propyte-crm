// ============================================================
// Catálogo de etiquetas del contacto (#936) — lado servidor
// ============================================================
// Contact.tags sigue guardando NOMBRES (String[]): así no cambian los filtros, la exportación, los
// flujos automáticos que agregan etiquetas (workflows, SPAM de moderación) ni la importación.
// Lo nuevo es que al guardar desde la ficha o el formulario (POST/PUT /api/contacts) cada etiqueta
// tiene que estar en el catálogo (contact_tags), escrita como allí: «lead frio» se guarda como
// «LEAD FRIO». Las que el contacto YA tenía se respetan aunque no estén en el catálogo (las
// pusieron procesos automáticos), para que editar otro campo no falle por ellas.

import { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { claveCatalogo, limpiarNombre, ETIQUETA_MAX, type OpcionCatalogo } from "@/lib/catalogos/clave";

/** Etiquetas elegibles (sin archivar), por nombre. */
export async function listarEtiquetas(): Promise<OpcionCatalogo[]> {
  return prisma.contactTag.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export type ResultadoEtiquetas = { ok: true; tags: string[] } | { ok: false; error: string; etiqueta: string };

/**
 * Traduce las etiquetas pedidas a las del catálogo. `actuales` = las que el contacto ya tiene
 * ([] al crear). Quita repetidas (misma clave), conserva el orden.
 */
export async function resolverEtiquetas(pedidas: string[], actuales: string[]): Promise<ResultadoEtiquetas> {
  const limpias = pedidas.map(limpiarNombre).filter(Boolean);
  if (limpias.length === 0) return { ok: true, tags: [] };

  const yaTenia = new Set(actuales);
  const claves = [...new Set(limpias.filter((t) => !yaTenia.has(t)).map(claveCatalogo))];
  const filas = claves.length
    ? await prisma.contactTag.findMany({
        where: { nameKey: { in: claves }, archivedAt: null },
        select: { name: true, nameKey: true },
      })
    : [];
  const porClave = new Map(filas.map((f) => [f.nameKey, f.name]));

  const tags: string[] = [];
  const vistas = new Set<string>();
  for (const t of limpias) {
    const nombre = yaTenia.has(t) ? t : porClave.get(claveCatalogo(t));
    if (!nombre) {
      return {
        ok: false,
        etiqueta: t,
        error: `La etiqueta «${t}» no existe. Créala con «Crear +» o elige una de la lista.`,
      };
    }
    const k = claveCatalogo(nombre);
    if (vistas.has(k)) continue;
    vistas.add(k);
    tags.push(nombre);
  }
  return { ok: true, tags };
}

export type ResultadoAlta<T> = { ok: true; data: T; creada: boolean } | { ok: false; error: string };

/**
 * «Crear +»: da de alta la etiqueta o devuelve la que ya existe con la misma clave (sin error: el
 * selector la elige y avisa «ya existía»). Una archivada que se vuelve a pedir se desarchiva.
 */
export async function crearEtiqueta(nombre: string, userId: string): Promise<ResultadoAlta<OpcionCatalogo>> {
  const name = limpiarNombre(nombre);
  if (!name) return { ok: false, error: "Escribe el nombre de la etiqueta" };
  if (name.length > ETIQUETA_MAX) return { ok: false, error: `Máximo ${ETIQUETA_MAX} caracteres` };
  const nameKey = claveCatalogo(name);

  const existente = await prisma.contactTag.findUnique({ where: { nameKey } });
  if (existente) {
    if (existente.archivedAt) {
      await prisma.contactTag.update({ where: { id: existente.id }, data: { archivedAt: null } });
    }
    return { ok: true, creada: false, data: { id: existente.id, name: existente.name } };
  }
  try {
    const nueva = await prisma.contactTag.create({ data: { name, nameKey, createdById: userId } });
    return { ok: true, creada: true, data: { id: nueva.id, name: nueva.name } };
  } catch (e) {
    // Dos personas creando la misma a la vez: la otra ganó; se devuelve la suya.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const ganadora = await prisma.contactTag.findUnique({ where: { nameKey } });
      if (ganadora) return { ok: true, creada: false, data: { id: ganadora.id, name: ganadora.name } };
    }
    throw e;
  }
}
