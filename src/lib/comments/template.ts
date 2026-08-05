// Render de plantillas y rotación de variantes. Compartido por el motor
// (handle-comment) y el probador en seco de la UI, para que lo que el probador
// muestra sea literalmente lo que saldría.

export interface TemplateVars {
  usuario: string | null;
}

/**
 * Sustituye {{usuario}} (con o sin espacios). Si no hay usuario, quita también
 * la coma o el espacio que quedaría colgando: "Hola , gracias" se ve mal y se
 * publica en un post real.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const usuario = vars.usuario?.trim();
  if (usuario) {
    return template.replace(/\{\{\s*usuario\s*\}\}/g, usuario);
  }
  return template.replace(/\s*,?\s*\{\{\s*usuario\s*\}\}/g, "");
}

/** Variante que corresponde según cuántas veces ya disparó la regla. */
export function pickVariant(variants: string[], firedCount: number): string | null {
  if (variants.length === 0) return null;
  const index = ((firedCount % variants.length) + variants.length) % variants.length;
  return variants[index];
}
