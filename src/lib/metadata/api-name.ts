// Nombre técnico (apiName) autogenerado desde la etiqueta — funciones PURAS (E7 #968).
// El usuario escribe "Notaría asignada" y el sistema produce `contact_notaria_asignada`.
// Cumple las mismas reglas que validateApiName (governance.ts): prefijo del objeto,
// snake_case en minúsculas, no reservado, máximo 60 caracteres.

const MAX_LARGO = 60;
const RESERVADOS = new Set(["id", "custom", "created_at", "updated_at", "deleted_at"]);

/** "Notaría  Asignada #2" → "notaria_asignada_2" (minúsculas, sin acentos, guiones bajos). */
export function slugDeEtiqueta(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Genera el apiName único para un campo nuevo.
 * - `existentes`: apiNames ya usados en el objeto (incluye archivados: la base los reserva).
 * - Si choca, agrega sufijo _2, _3…
 */
export function generarApiName(objectApiName: string, etiqueta: string, existentes: Iterable<string>): string {
  const prefijo = `${objectApiName}_`;
  const usados = new Set(existentes);
  let base = slugDeEtiqueta(etiqueta);
  if (!base) base = "campo";
  // La parte posterior al prefijo debe empezar con letra
  if (!/^[a-z]/.test(base)) base = `campo_${base}`;
  if (RESERVADOS.has(base)) base = `${base}_campo`;

  const recortar = (b: string, sufijo: string) => {
    const espacio = MAX_LARGO - prefijo.length - sufijo.length;
    return b.slice(0, Math.max(1, espacio)).replace(/_+$/, "") + sufijo;
  };

  let candidato = prefijo + recortar(base, "");
  let n = 2;
  while (usados.has(candidato)) {
    candidato = prefijo + recortar(base, `_${n}`);
    n++;
  }
  return candidato;
}

export interface OpcionEntrada {
  /** value existente (se conserva al editar); ausente en opciones nuevas */
  value?: string;
  label: string;
  color?: string;
}

/**
 * Convierte filas del editor en opciones listas para la API:
 * quita vacías, conserva el value de las existentes y genera el de las nuevas
 * (sin acentos, único entre todas).
 */
export function construirOpciones(filas: OpcionEntrada[]): Array<{ value: string; label: string; color?: string }> {
  const limpias = filas.map((f) => ({ ...f, label: f.label.trim() })).filter((f) => f.label);
  const usados = new Set(limpias.map((f) => f.value).filter((v): v is string => !!v));
  return limpias.map((f) => {
    let value = f.value;
    if (!value) {
      const base = slugDeEtiqueta(f.label) || "opcion";
      value = base;
      let n = 2;
      while (usados.has(value)) value = `${base}_${n++}`;
      usados.add(value);
    }
    return { value, label: f.label, ...(f.color ? { color: f.color } : {}) };
  });
}

/** "Notaría 1, Notaría 7" → filas del editor (para el alta rápida con coma). */
export function opcionesDeTexto(texto: string): OpcionEntrada[] {
  return texto.split(",").map((label) => ({ label }));
}
