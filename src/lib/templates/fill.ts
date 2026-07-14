// Sustitución de variables de plantillas (regla J.2): {{k}} → valor; una línea con
// variables sin resolver se ELIMINA completa — nunca se envía {{...}} crudo al cliente.
// Única semántica compartida: composer del inbox (cliente) y workflows (server).

export function fillTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  let out = body;
  for (const [k, v] of Object.entries(vars)) {
    if (v != null && v !== "") out = out.replaceAll(`{{${k}}}`, v);
  }
  return out
    .split("\n")
    .filter((line) => !/\{\{[^}]+\}\}/.test(line))
    .join("\n")
    .trim();
}

/** Variables estándar de contacto para plantillas del inbox. */
export function contactTemplateVars(contact: { firstName?: string | null; lastName?: string | null }): Record<string, string> {
  const placeholder = /^\((por identificar|sin apellido)\)$/i;
  const clean = (v?: string | null) => (v && !placeholder.test(v.trim()) ? v.trim() : "");
  return {
    "contact.firstName": clean(contact.firstName),
    "contact.lastName": clean(contact.lastName),
  };
}
