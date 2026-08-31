/**
 * Estados terminales de una corrida de agente que el enum `AgentRunStatus` todavía no
 * distingue.
 *
 * Módulo hoja a propósito —sin prisma, sin fetch, sin config— porque lo comparten el
 * runner (que escribe la marca) y la puerta de revisión (que la lee). Duplicar el literal
 * en los dos lados es exactamente cómo se rompe un acuerdo así en el siguiente renombrado.
 *
 * ## Por qué una marca en `error` y no un valor de enum
 *
 * El arreglo correcto es un estado propio (`TRUNCATED`/`MAX_STEPS`) en `AgentRunStatus`.
 * Se descartó por ahora porque exige migrar el tipo en Postgres, y este repo no tiene
 * automatización de migraciones: el despliegue no corre `prisma migrate deploy`. Si el
 * código saliera antes que el `ALTER TYPE`, cada corrida agotada reventaría al escribir su
 * propio cierre —y también el `catch` que intentaría rescatarla—, que es peor que el bug
 * que se está arreglando. `FAILED` + marca estable deja la corrida VISIBLE hoy y sin
 * ventana de despliegue. El ascenso a enum queda como tarjeta aparte.
 */

/** Prefijo del `error` de una corrida que se quedó sin pasos antes de concluir. */
export const MAX_STEPS_AGOTADOS = "MAX_STEPS_AGOTADOS";

/**
 * Prefijo del `error` de una corrida cuyo ÚLTIMO turno lo cortó el tope de tokens.
 *
 * Distinta causa que quedarse sin pasos y distinta cura —subir `maxTokens` contra subir
 * `maxSteps`— pero el mismo desenlace: el agente no concluyó. El proveedor lo avisa en
 * `stop_reason: "max_tokens"`; ignorarlo hace que una frase cortada a la mitad se guarde
 * como si fuera la conclusión del agente.
 */
export const RESPUESTA_TRUNCADA = "RESPUESTA_TRUNCADA";

/**
 * ¿Esta corrida se quedó a medias en vez de reventar?
 *
 * La distinción importa al reportar: un agente que agotó su presupuesto —de pasos o de
 * tokens— pide subirle el límite o recortarle el objetivo; uno que reventó pide arreglar
 * lo que reventó. Meterlos en el mismo montón hace que el segundo se pierda entre los
 * primeros.
 */
export function esCorridaSinTerminar(error: string | null | undefined): boolean {
  if (typeof error !== "string") return false;
  return error.startsWith(MAX_STEPS_AGOTADOS) || error.startsWith(RESPUESTA_TRUNCADA);
}

/** Lo que la puerta de revisión necesita saber de una corrida: qué costó y qué tardó. */
export type ResumenDeCorrida = {
  tokens_entrada: number;
  tokens_salida: number;
  ms_modelo: number;
  ms_tool: number;
  pasos: number;
};

/**
 * Suma los pasos de una corrida en su total de tokens y de tiempo.
 *
 * Vive aquí y no en el runner porque quien lo necesita es el LECTOR: `AgentRun.steps` es
 * la única columna donde caben estas cifras —el modelo no tiene campos de tokens— así que
 * cualquiera que quiera el total tiene que sumarlas. Que esa suma exista una sola vez es
 * lo que evita que cada consumidor invente su propia versión del gasto.
 *
 * Tolera pasos viejos sin medición: los escritos antes de instrumentar el runner suman 0,
 * que es honesto —no se midieron— y no rompe la lectura.
 */
export function resumenDeCorrida(steps: unknown): ResumenDeCorrida {
  const vacio: ResumenDeCorrida = {
    tokens_entrada: 0,
    tokens_salida: 0,
    ms_modelo: 0,
    ms_tool: 0,
    pasos: 0,
  };
  if (!Array.isArray(steps)) return vacio;

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return steps.reduce<ResumenDeCorrida>((acc, crudo) => {
    const paso = (crudo ?? {}) as Record<string, unknown>;
    return {
      tokens_entrada: acc.tokens_entrada + num(paso.tokens_entrada),
      tokens_salida: acc.tokens_salida + num(paso.tokens_salida),
      ms_modelo: acc.ms_modelo + num(paso.ms_modelo),
      ms_tool: acc.ms_tool + num(paso.ms_tool),
      pasos: acc.pasos + 1,
    };
  }, vacio);
}
