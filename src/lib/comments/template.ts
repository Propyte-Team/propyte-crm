// Render de plantillas y rotación de variantes. Compartido por el motor
// (handle-comment) y el probador en seco de la UI, para que lo que el probador
// muestra sea literalmente lo que saldría.

export interface TemplateVars {
  usuario: string | null;
}

/**
 * Sustituye {{usuario}} (con o sin espacios). `usuario` viene de `from.name`
 * de Facebook/Instagram, un display name sin restricción de caracteres: usar
 * función de reemplazo, no string, para que `$&`, `` $` ``, `$'`, `$$`, `$N`
 * no se interpreten como patrones especiales de `String.replace`.
 *
 * Si no hay usuario, quita el placeholder y limpia SOLO su vecindad inmediata
 * (coma/espacio antes, o puntuación al inicio de la línea): "Hola , gracias"
 * o ", bienvenido!" se ven mal y se publican en un post real. La limpieza no
 * toca el resto del template porque el DM es un textarea multilínea: otros
 * párrafos pueden traer sangría o espaciado intencional que no hay que tocar.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const usuario = vars.usuario?.trim();
  if (usuario) {
    return template.replace(/\{\{\s*usuario\s*\}\}/g, () => usuario);
  }
  // Sin usuario: se limpia SOLO alrededor del placeholder, no el resto del texto
  // (un DM puede traer sangría o espaciado intencional en otros párrafos).
  return template
    // Al inicio del texto o de una línea: se lleva la puntuación y el espacio que le siguen,
    // para no dejar ", bienvenido" colgando.
    .replace(/(^|\n)[ \t]*\{\{\s*usuario\s*\}\}[ \t]*[,;:]?[ \t]*/g, "$1")
    // En medio de una frase: se lleva el espacio que lo precede y conserva lo que sigue,
    // para que "Hola {{usuario}}, gracias" quede "Hola, gracias".
    .replace(/[ \t]*\{\{\s*usuario\s*\}\}/g, "")
    // Saludo vacío al principio: no dejar el texto arrancando con líneas en blanco.
    .replace(/^\n+/, "");
}

/** Variante que corresponde según cuántas veces ya disparó la regla. */
export function pickVariant(variants: string[], firedCount: number): string | null {
  if (!Number.isInteger(firedCount)) return null;
  if (variants.length === 0) return null;
  const index = ((firedCount % variants.length) + variants.length) % variants.length;
  return variants[index];
}
