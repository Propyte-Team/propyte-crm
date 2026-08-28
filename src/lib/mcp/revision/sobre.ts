import type { RespuestaRevision, Sobre } from "./types";

/**
 * El sobre de rotulado (§4.3 del spec).
 *
 * POR QUÉ EXISTE. Durante el diseño de esta puerta se reprodujo el fallo que la motiva:
 * un checkout local en una rama vieja no contenía archivos que sí estaban en `main`. Un
 * revisor que leyera "el código" sin saber DE DÓNDE lo leyó habría reportado que no
 * existen — y este proyecto ya pagó cuatro hallazgos falsos exactamente así.
 *
 * De modo que el SHA no es metadato decorativo: es lo que hace citable un hallazgo. El
 * protocolo diario obliga a repetirlo en cada tarea que se registra en el tablero.
 */

/** Tope global de §4.5: ninguna respuesta pasa de esto. */
export const TOPE_RESPUESTA_BYTES = 200_000;

export function construirSobre(opts: {
  ref: string;
  sha: string | null;
  ahora: Date;
  alcance: string;
  truncado?: Sobre["truncado"];
}): Sobre {
  return {
    ref: opts.ref,
    sha: opts.sha,
    medido_en: opts.ahora.toISOString(),
    alcance: opts.alcance,
    ...(opts.truncado ? { truncado: opts.truncado } : {}),
  };
}

export function envolver<T>(sobre: Sobre, datos: T): RespuestaRevision<T> {
  return { sobre, datos };
}

/**
 * Recorta una lista al tope y DECLARA el recorte en el sobre.
 *
 * El recorte silencioso es el modo de falla caro: quien recibe 30 de 400 fallos sin que
 * nadie se lo diga concluye que hay 30 fallos, y esa cifra acaba en una tarea del
 * tablero como si estuviera medida.
 */
export function recortar<T>(
  items: T[],
  tope: number,
  motivo: string,
): { items: T[]; truncado?: Sobre["truncado"] } {
  if (items.length <= tope) return { items };
  return {
    items: items.slice(0, tope),
    truncado: { motivo, devueltos: tope, tope },
  };
}

/**
 * Última red antes de contestar: si el JSON serializado se pasa del tope global, se
 * devuelve un aviso en lugar del payload.
 *
 * Devolver el payload cortado a la mitad sería peor que no devolverlo — un JSON truncado
 * a la mitad ni siquiera parsea, y el cliente reportaría "la puerta está rota" en vez de
 * "pide menos".
 */
export function verificarTamano<T>(
  respuesta: RespuestaRevision<T>,
): RespuestaRevision<T> | RespuestaRevision<{ error: string; bytes: number }> {
  const bytes = Buffer.byteLength(JSON.stringify(respuesta), "utf8");
  if (bytes <= TOPE_RESPUESTA_BYTES) return respuesta;

  return {
    sobre: {
      ...respuesta.sobre,
      truncado: {
        motivo: "La respuesta completa pasó el tope global; no se devolvió nada parcial.",
        devueltos: 0,
        tope: TOPE_RESPUESTA_BYTES,
      },
    },
    datos: {
      error:
        `La respuesta pesa ${bytes} bytes y el tope es ${TOPE_RESPUESTA_BYTES}. ` +
        "Acota la petición: un rango de líneas más corto, una ventana de fechas menor o un `glob` más específico.",
      bytes,
    },
  };
}
