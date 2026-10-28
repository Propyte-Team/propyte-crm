/**
 * Texto de duración de una actividad para la cronología.
 *
 * - Con segundos (llamadas de Twilio): "45 s", "1 min", "2 min 05 s".
 * - Sin segundos (filas anteriores o capturadas a mano): "N min", como siempre.
 * - Si alguien editó los minutos a mano después de la llamada, los segundos ya no
 *   corresponden; en ese caso manda lo que escribió la persona.
 * - Duración 0 o vacía: null (la tarjeta no muestra duración).
 */
export function formatoDuracion(
  segundos: number | null | undefined,
  minutos: number | null | undefined,
): string | null {
  const s = typeof segundos === "number" && Number.isFinite(segundos) && segundos > 0 ? Math.floor(segundos) : null
  const m = typeof minutos === "number" && Number.isFinite(minutos) && minutos > 0 ? minutos : null

  if (s !== null && (m === null || Math.ceil(s / 60) === m)) {
    if (s < 60) return `${s} s`
    const min = Math.floor(s / 60)
    const resto = s % 60
    return resto === 0 ? `${min} min` : `${min} min ${String(resto).padStart(2, "0")} s`
  }
  return m !== null ? `${m} min` : null
}
