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
 * Si no hay usuario, quita el placeholder y limpia lo que quedaría colgando
 * (coma/espacio antes, o puntuación al inicio de la frase): "Hola , gracias"
 * o ", bienvenido!" se ven mal y se publican en un post real.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const usuario = vars.usuario?.trim();
  if (usuario) {
    return template.replace(/\{\{\s*usuario\s*\}\}/g, () => usuario);
  }
  return template
    .replace(/\{\{\s*usuario\s*\}\}/g, "")
    .replace(/[ \t]{2,}/g, " ") // espacios dobles, sin tocar saltos de línea
    .replace(/\s+([,;:.!?])/g, "$1") // " ," -> ","
    .replace(/^[\s,;:]+/, "") // puntuación colgando al inicio
    .trim();
}

/** Variante que corresponde según cuántas veces ya disparó la regla. */
export function pickVariant(variants: string[], firedCount: number): string | null {
  if (!Number.isInteger(firedCount)) return null;
  if (variants.length === 0) return null;
  const index = ((firedCount % variants.length) + variants.length) % variants.length;
  return variants[index];
}
