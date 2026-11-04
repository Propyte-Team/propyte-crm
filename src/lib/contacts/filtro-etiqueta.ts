// #958: filtro «Etiqueta» de la lista de Contactos (?etiqueta=). Lo usan los enlaces de las tareas
// de la migración de estados («Elegir razón…», «Confirmar el broker…») y sirve para cualquier etiqueta.
// Se compara exacto contra contacts.tags, que guarda los NOMBRES tal como quedaron (ver
// lib/contacts/etiquetas.ts). Vacío o demasiado largo = sin filtro.
import { ETIQUETA_MAX } from "@/lib/catalogos/clave";

export const PARAM_ETIQUETA = "etiqueta";

export function etiquetaDelFiltro(valor: string | string[] | null | undefined): string | null {
  const v = (Array.isArray(valor) ? valor[0] : valor)?.replace(/\s+/g, " ").trim() ?? "";
  if (!v || v.length > ETIQUETA_MAX) return null;
  return v;
}

/** Condición de Prisma para la etiqueta (null = sin filtro). */
export function whereEtiqueta(etiqueta: string | null): { tags: { has: string } } | null {
  return etiqueta ? { tags: { has: etiqueta } } : null;
}
