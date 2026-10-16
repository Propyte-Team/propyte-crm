// Fichas técnicas (#887) — los textos para compartir, en un archivo sin dependencias de servidor
// para que los usen igual el botón del CRM y la ficha pública. Una sola redacción: si cambia,
// cambia en los dos lados.

export type TipoFicha = "DESARROLLO" | "UNIDAD";

interface Nombrable {
  titulo: string;
  subtitulo: string | null;
  tipo: TipoFicha;
}

/** Texto que acompaña el enlace cuando se comparte (por el asesor o por quien lo reenvía). */
export function textoParaCompartir(v: Nombrable): string {
  const nombre = v.tipo === "UNIDAD" && v.subtitulo ? `${v.titulo} en ${v.subtitulo}` : v.titulo;
  return `Te comparto la ficha técnica de ${nombre}:`;
}

/** WhatsApp sin destinatario (WhatsApp pide el contacto) con el MISMO enlace de la ficha. */
export function enlaceParaReenviar(url: string, v: Nombrable): string {
  return `https://wa.me/?text=${encodeURIComponent(`${textoParaCompartir(v)} ${url}`)}`;
}
