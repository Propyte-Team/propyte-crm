// "Pasa a humano cuando…": helpers PUROS para editar BotConfig.escalationTriggers.
//
// Cómo lo usa el motor (src/lib/bot/claude.ts, buildBrandRules): la lista se une con comas y entra
// al prompt como "alguno de estos temas (a, b, c)"; si el modelo detecta uno responde con una
// transición breve y el token [ESCALAR], y bot-respond pasa el hilo a un asesor. O sea: cada
// elemento es un TEMA en texto libre (no hay disparadores por conteo de mensajes ni por palabras
// clave exactas). Los cuatro de fábrica son claves en snake_case; los que agregue el usuario se
// guardan tal cual los escriba, en español, para que el modelo los entienda.
export const MAX_DISPARADORES = 20; // tope del esquema (bot-config.schema.ts)
export const MAX_LARGO_TEMA = 80;

export interface DisparadorConocido {
  valor: string;
  etiqueta: string;
  ayuda: string;
}

/** Los cuatro de fábrica (DEFAULT_BOT_CONFIG.escalationTriggers). */
export const DISPARADORES_DE_FABRICA: readonly DisparadorConocido[] = [
  { valor: "apartar", etiqueta: "Quiere apartar o reservar", ayuda: "Dice que quiere apartar una unidad o dar un anticipo." },
  { valor: "queja", etiqueta: "Se queja o está molesto", ayuda: "Reclamos, enojo o mala experiencia." },
  { valor: "legal_fiscal", etiqueta: "Pregunta por temas legales o fiscales", ayuda: "Contratos, escrituras, impuestos, fideicomisos." },
  { valor: "negociacion", etiqueta: "Quiere negociar precio o condiciones", ayuda: "Descuentos, plazos de pago, mejores condiciones." },
];

/** Sugerencias que se agregan con un clic; se guardan como el texto que ven. */
export const DISPARADORES_SUGERIDOS: readonly string[] = [
  "pide hablar con una persona",
  "pide una llamada o una visita",
];

const ETIQUETAS: Record<string, string> = Object.fromEntries(DISPARADORES_DE_FABRICA.map((d) => [d.valor, d.etiqueta]));

export function etiquetaDisparador(valor: string): string {
  return ETIQUETAS[valor] ?? valor;
}

/** Prende o apaga un disparador de fábrica sin tocar los demás. */
export function alternarDisparador(lista: readonly string[], valor: string, on: boolean): string[] {
  if (on) return lista.includes(valor) ? [...lista] : [...lista, valor];
  return lista.filter((v) => v !== valor);
}

/** Los que no son de fábrica (los agregó una persona). */
export function temasPersonalizados(lista: readonly string[]): string[] {
  return lista.filter((v) => !(v in ETIQUETAS));
}

export type ResultadoAgregar = { ok: true; lista: string[] } | { ok: false; motivo: string };

/** Agrega un tema escrito a mano: recorta espacios, evita repetidos (sin distinguir mayúsculas) y respeta los topes. */
export function agregarTema(lista: readonly string[], texto: string): ResultadoAgregar {
  const tema = texto.replace(/\s+/g, " ").trim();
  if (!tema) return { ok: false, motivo: "Escribe el tema." };
  if (tema.length > MAX_LARGO_TEMA) return { ok: false, motivo: `Máximo ${MAX_LARGO_TEMA} caracteres.` };
  if (lista.some((v) => v.toLowerCase() === tema.toLowerCase() || etiquetaDisparador(v).toLowerCase() === tema.toLowerCase())) {
    return { ok: false, motivo: "Ese tema ya está en la lista." };
  }
  if (lista.length >= MAX_DISPARADORES) return { ok: false, motivo: `Máximo ${MAX_DISPARADORES} temas.` };
  return { ok: true, lista: [...lista, tema] };
}

export function quitarTema(lista: readonly string[], tema: string): string[] {
  return lista.filter((v) => v !== tema);
}
