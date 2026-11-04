// "Largo de respuesta" del bot: tres opciones de negocio (Corto / Normal / Largo) sobre el ajuste
// numérico que ya existe (BotConfig.maxLines, 1–8 líneas). Sin migración: el valor guardado sigue
// siendo maxLines. También deriva el tope de tokens que se le pide al modelo, para que un
// "Corto" no solo lo pida en el prompt sino que tampoco se pueda alargar sin querer.

export type LargoRespuesta = "corto" | "normal" | "largo";

export const LARGOS_DE_RESPUESTA: Array<{ valor: LargoRespuesta; etiqueta: string; lineas: number; descripcion: string }> = [
  { valor: "corto", etiqueta: "Corto", lineas: 2, descripcion: "Una o dos líneas, directo al punto." },
  { valor: "normal", etiqueta: "Normal", lineas: 4, descripcion: "Mensajes breves estilo WhatsApp (lo habitual)." },
  { valor: "largo", etiqueta: "Largo", lineas: 6, descripcion: "Más detalle cuando el cliente pregunta cosas complejas." },
];

/** maxLines guardado → opción más cercana (cubre valores viejos como 1, 3, 5, 8). */
export function largoDeLineas(maxLines: number): LargoRespuesta {
  if (!Number.isFinite(maxLines) || maxLines <= 2) return "corto";
  if (maxLines <= 4) return "normal";
  return "largo";
}

export function lineasDeLargo(largo: LargoRespuesta): number {
  return LARGOS_DE_RESPUESTA.find((l) => l.valor === largo)!.lineas;
}

const TOKENS: Record<LargoRespuesta, number> = { corto: 200, normal: 300, largo: 450 };

/** Tope de tokens de la respuesta según las líneas configuradas (normal = 300, el valor de siempre). */
export function maxTokensDeLineas(maxLines: number | null | undefined): number {
  return TOKENS[largoDeLineas(maxLines ?? 4)];
}
