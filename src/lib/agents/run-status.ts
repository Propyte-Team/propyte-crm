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
 * ¿Esta corrida terminó por agotamiento de pasos y no por un error de verdad?
 *
 * La distinción importa al reportar: un agente que se quedó sin pasos pide subirle el
 * límite o recortarle el objetivo; uno que reventó pide arreglar lo que reventó. Meterlos
 * en el mismo montón hace que el segundo se pierda entre los primeros.
 */
export function esCorridaAgotada(error: string | null | undefined): boolean {
  return typeof error === "string" && error.startsWith(MAX_STEPS_AGOTADOS);
}
