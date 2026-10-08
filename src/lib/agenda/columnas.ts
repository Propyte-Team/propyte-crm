// Columnas configurables de las tablas de Reuniones y Llamadas de la Agenda (HUB #842,
// referencia: "Gestionar columnas" de Zoho CRM). Módulo PURO: define el catálogo y sanea la
// preferencia guardada; el almacenamiento (localStorage) vive en el componente.

export interface ColumnaDef {
  key: string;
  label: string;
  /** No se puede ocultar (en Zoho lleva asterisco rojo). */
  required?: boolean;
  /** Visible la primera vez, antes de que el usuario guarde su preferencia. */
  defaultVisible?: boolean;
}

export type TablaAgenda = "reuniones" | "llamadas";

export const COLUMNAS_REUNIONES: ColumnaDef[] = [
  { key: "titulo", label: "Título", required: true, defaultVisible: true },
  { key: "de", label: "De", defaultVisible: true },
  { key: "a", label: "A", defaultVisible: true },
  { key: "relacionado", label: "Relacionado con", defaultVisible: true },
  { key: "contacto", label: "Nombre de contacto", defaultVisible: true },
  { key: "host", label: "Host" },
  { key: "tipo", label: "Tipo de reunión" },
  { key: "resultado", label: "Resultado de la reunión" },
  { key: "creadoPor", label: "Creado por" },
  { key: "creado", label: "Hora de creación" },
  { key: "modificado", label: "Hora de modificación" },
  { key: "descripcion", label: "Descripción" },
];

export const COLUMNAS_LLAMADAS: ColumnaDef[] = [
  { key: "asunto", label: "Asunto", required: true, defaultVisible: true },
  { key: "relacionado", label: "Relacionado con", defaultVisible: true },
  { key: "inicio", label: "Hora de inicio de la llamada", defaultVisible: true },
  { key: "telefono", label: "Número de destino", defaultVisible: true },
  { key: "propietario", label: "Propietario de la llamada" },
  { key: "tipo", label: "Tipo de llamada" },
  { key: "contacto", label: "Nombre de contacto" },
  { key: "duracion", label: "Duración de la llamada" },
  { key: "descripcion", label: "Descripción" },
];

export const COLUMNAS: Record<TablaAgenda, ColumnaDef[]> = {
  reuniones: COLUMNAS_REUNIONES,
  llamadas: COLUMNAS_LLAMADAS,
};

/** Clave de localStorage de cada tabla. Versionada: si cambia el catálogo se sube el sufijo. */
export function storageKeyColumnas(tabla: TablaAgenda): string {
  return `agenda.columnas.${tabla}.v1`;
}

/**
 * Columnas a mostrar, en el orden del catálogo. `guardadas` es lo que había en el
 * almacenamiento (null si nada, o cualquier cosa si el JSON estaba corrupto): se descartan
 * claves que ya no existen, se fuerzan las obligatorias y, sin preferencia válida, se usan
 * los valores por defecto. Nunca devuelve una lista sin la columna obligatoria.
 */
export function columnasVisibles(defs: ColumnaDef[], guardadas: unknown): string[] {
  const defaults = defs.filter((d) => d.required || d.defaultVisible).map((d) => d.key);

  if (!Array.isArray(guardadas)) return defaults;

  const elegidas = new Set(guardadas.filter((k): k is string => typeof k === "string"));
  const validas = defs.filter((d) => d.required || elegidas.has(d.key)).map((d) => d.key);

  // Preferencia con claves pero ninguna reconocible (catálogo cambiado): vuelve al default.
  // Una lista vacía o solo con la obligatoria es una elección válida ("solo lo esencial").
  const reconoce = defs.some((d) => elegidas.has(d.key));
  return reconoce || elegidas.size === 0 ? validas : defaults;
}

/** Filtra el catálogo por el texto del buscador del modal (sin acentos ni mayúsculas). */
export function filtrarColumnas(defs: ColumnaDef[], texto: string): ColumnaDef[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = norm(texto.trim());
  if (!q) return defs;
  return defs.filter((d) => norm(d.label).includes(q));
}
