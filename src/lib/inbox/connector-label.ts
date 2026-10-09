// Etiqueta de marca de la cuenta (conector) de una conversación del Inbox — "WhatsApp · Marca".
// 2026-10-09 (spec marcas-agente): manda la marca asignada a la cuenta (Brand.name); si la cuenta
// no tiene marca se conserva el texto libre que ya vivía en `config.brand`, para que lo que se veía
// hasta hoy no cambie. Lo comparten la lista (/api/conversations) y el detalle (/api/conversations/[id]).
export function connectorBrandLabel(connector: {
  config: unknown;
  brand?: { name: string } | null;
}): string | null {
  const legacy = (connector.config as Record<string, unknown> | null)?.brand;
  return connector.brand?.name ?? (typeof legacy === "string" ? legacy : null);
}
