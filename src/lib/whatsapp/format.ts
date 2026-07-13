// formatForWhatsApp — puente markdown → formato nativo de WhatsApp (fix 2026-07-13).
// Problema de prod: los LLM emiten **negrita** / __negrita__ / # encabezados, pero
// WhatsApp solo renderea *negrita* (UN asterisco) y muestra los ** literales.
// Función PURA e IDEMPOTENTE: se aplica en el transport (deliverWhatsApp) y en el
// servicio (sendWhatsAppMessage, que persiste el mismo texto que sale por la red),
// así que aplicarla dos veces debe dar el mismo resultado.
// Deja intacto lo que ya es formato WhatsApp: *negrita*, _itálica_, ~tachado~,
// URLs, emojis y saltos de línea.

// Envuelve cada línea del contenido en *…* (WhatsApp no formatea cruzando saltos de
// línea, así que una negrita multilínea se convierte en una negrita por línea).
// Recorta espacios pegados al delimitador: "* x *" tampoco renderea en WhatsApp.
function boldPerLine(inner: string): string {
  return inner
    .split("\n")
    .map((line) => (line.trim() ? `*${line.trim()}*` : line))
    .join("\n");
}

// Convierte pares de un delimitador doble (** o __) en negrita WhatsApp.
// Dos pasadas: primero pares dentro de la misma línea (para que un ** suelto en una
// línea no "capture" hasta la negrita válida de la línea siguiente), y después pares
// que sí cruzan saltos de línea. Un delimitador sin cierre queda intacto.
function convertDoubleDelimiter(text: string, escapedDelimiter: string): string {
  const sameLine = new RegExp(`${escapedDelimiter}([^\\n]+?)${escapedDelimiter}`, "g");
  const multiLine = new RegExp(`${escapedDelimiter}([\\s\\S]+?)${escapedDelimiter}`, "g");
  return text
    .replace(sameLine, (_m, inner: string) => boldPerLine(inner))
    .replace(multiLine, (_m, inner: string) => boldPerLine(inner));
}

export function formatForWhatsApp(text: string): string {
  let out = text;

  // ***negrita-itálica*** primero (si no, ** ** la partiría dejando asteriscos sueltos)
  out = out.replace(/\*\*\*([^\n]+?)\*\*\*/g, (_m, inner: string) => boldPerLine(inner));

  // **negrita** y __negrita__ → *negrita*
  out = convertDoubleDelimiter(out, "\\*\\*");
  out = convertDoubleDelimiter(out, "__");

  // # Encabezados al inicio de línea → *negrita* (o solo quitar los # si el texto ya
  // trae asteriscos, para no anidar). "#hashtag" (sin espacio tras #) no se toca.
  out = out.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*)$/gm, (_m, title: string) => {
    const t = title.trim();
    if (!t) return "";
    return t.includes("*") ? t : `*${t}*`;
  });

  return out;
}
