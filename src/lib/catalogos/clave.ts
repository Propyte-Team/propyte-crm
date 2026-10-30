// ============================================================
// Catálogos de contacto (#936 etiquetas, #937 campañas y eventos): normalización compartida.
// ============================================================
// Puro (sin Prisma): lo usan el servidor y los selectores del cliente.
//
// Dos nombres son «el mismo» si coinciden sin importar mayúsculas, acentos ni espacios de más:
// «LEAD FRIO», «Lead frío» y « lead  frio » son la misma etiqueta. La base guarda esa clave en
// `nameKey` (único), así que el catálogo no puede tener dos variantes de lo mismo.
//
// La migración 2026-10-30-catalogos-contacto.sql siembra `nameKey` con la MISMA regla en SQL
// (lower + translate de vocales acentuadas, ü y ñ + espacios colapsados). Si cambias esta función,
// cambia también esa expresión.

/** Espacios colapsados y recortados. Es el nombre que se guarda (respeta mayúsculas y acentos). */
export function limpiarNombre(nombre: string): string {
  return nombre.replace(/\s+/g, " ").trim();
}

/** Clave de comparación: sin acentos, en minúsculas y con espacios colapsados. */
export function claveCatalogo(nombre: string): string {
  return limpiarNombre(nombre)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export interface OpcionCatalogo {
  id: string;
  name: string;
}

/** Filtra opciones por texto (sin acentos ni mayúsculas); cada palabra debe aparecer. */
export function filtrarCatalogo<T extends OpcionCatalogo>(opciones: T[], texto: string): T[] {
  const palabras = claveCatalogo(texto).split(" ").filter(Boolean);
  if (palabras.length === 0) return opciones;
  return opciones.filter((o) => {
    const k = claveCatalogo(o.name);
    return palabras.every((p) => k.includes(p));
  });
}

/** La opción que ya existe con ese nombre (misma clave), si la hay. */
export function buscarPorNombre<T extends OpcionCatalogo>(opciones: T[], nombre: string): T | undefined {
  const k = claveCatalogo(nombre);
  return k ? opciones.find((o) => claveCatalogo(o.name) === k) : undefined;
}

/**
 * Roles que pueden usar «Crear +» (decisión de sistemas@, 30-oct: todos los que editan
 * contactos). Es la misma lista que puede dar de alta un contacto en POST /api/contacts.
 */
const ROLES_CREAN_EN_CATALOGO = new Set([
  "ADMIN",
  "DIRECTOR",
  "DEVELOPER_EXT",
  "MANTENIMIENTO",
  "GERENTE",
  "TEAM_LEADER",
  "ASESOR",
  "ASESOR_SR",
  "ASESOR_JR",
  "BROKER",
  "HOSTESS",
]);

export function puedeCrearEnCatalogo(role: string | null | undefined): boolean {
  return !!role && ROLES_CREAN_EN_CATALOGO.has(role);
}

/** Largo máximo del nombre de una etiqueta (el mismo tope que ya tenía Contact.tags). */
export const ETIQUETA_MAX = 50;
/** Largo máximo del nombre de una campaña o evento. */
export const CAMPANA_MAX = 120;

/** Tipos de «Detalle de la fuente» (#937). TEXT en la base: agregar uno es una línea aquí. */
export const TIPOS_CAMPANA = [
  { value: "CAMPANA", label: "Campaña" },
  { value: "EVENTO", label: "Evento" },
] as const;
export type TipoCampana = (typeof TIPOS_CAMPANA)[number]["value"];

export function esTipoCampana(v: unknown): v is TipoCampana {
  return TIPOS_CAMPANA.some((t) => t.value === v);
}

export function etiquetaTipoCampana(v: string | null | undefined): string {
  return TIPOS_CAMPANA.find((t) => t.value === v)?.label ?? "";
}

/**
 * Qué mandar de «Detalle de la fuente» (campaignId) al guardar el formulario: al crear, solo si se
 * eligió una; al editar, solo si cambió (null = quitarla). Mismo trato que campoEmpresa (#949).
 */
export function campoCampana(
  mode: "create" | "edit",
  inicialId: string | null,
  actualId: string | null,
): { campaignId?: string | null } {
  if (mode === "create") return actualId ? { campaignId: actualId } : {};
  return actualId === inicialId ? {} : { campaignId: actualId };
}

/**
 * El texto viejo de «Detalle de la fuente» que vale la pena mostrar como referencia en el
 * formulario. Los «comentario:<id>» son técnicos (los lee el bot) y no se muestran.
 */
export function detalleFuenteHistorico(detalle: string | null | undefined): string | null {
  const d = (detalle ?? "").trim();
  if (!d || d.startsWith("comentario:")) return null;
  return d;
}
