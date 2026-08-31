import { esCorridaSinTerminar } from "@/lib/agents/run-status";
import { badRequest } from "../errors";
import { firmaDeError, redactar } from "../redactar";
import { recortar } from "../sobre";
import type { RevisionContext } from "../types";

/**
 * `crm_fallos` — lo que se rompió, AGRUPADO.
 *
 * Un log crudo no es una medición: 400 filas del mismo bug se leen como 400 bugs, y una
 * tarea que dice "400 fallos" cuando hay uno solo es peor que no tener la tarea. Por eso
 * todo sale agrupado por firma de error, con su conteo y UN ejemplo redactado.
 *
 * 🚨 NUNCA SE DEVUELVE EL PAYLOAD CRUDO. `ConnectorLeadLog.rawPayload` es el lead entero
 * que llegó del anunciante —nombre, correo, teléfono— y `ActionQueue.config` puede traer
 * el cuerpo de un mensaje. El `select` los excluye a mano; los mensajes de error, que sí
 * salen, pasan por `redactar()`.
 *
 * Cubre fallos de NEGOCIO, no excepciones de runtime: no existe agregador de 500s de Next
 * en este repo, y decir que sí lo hay llevaría a concluir "no hay errores" cuando lo
 * cierto es "no los estamos mirando". La limitación va declarada en la respuesta.
 */

const TOPE_GRUPOS = 30;
const HORA = 60 * 60 * 1000;

type Grupo = { firma: string; casos: number; ejemplo: string; ultimo: string | null };

function agrupar(
  filas: Array<{ clave: string; error: string | null; fecha: Date | null }>,
): Grupo[] {
  const mapa = new Map<string, Grupo>();
  for (const f of filas) {
    const firma = `${f.clave} · ${firmaDeError(f.error) || "sin mensaje"}`;
    const previo = mapa.get(firma);
    const fecha = f.fecha?.toISOString() ?? null;
    if (previo) {
      previo.casos += 1;
      if (fecha && (!previo.ultimo || fecha > previo.ultimo)) previo.ultimo = fecha;
    } else {
      mapa.set(firma, {
        firma,
        casos: 1,
        ejemplo: redactar(f.error).slice(0, 400),
        ultimo: fecha,
      });
    }
  }
  return [...mapa.values()].sort((a, b) => b.casos - a.casos);
}

export async function fallos(args: unknown, ctx: RevisionContext) {
  const { db, ahora } = ctx;
  const crudo = (args ?? {}) as { desde?: unknown };

  let desde = new Date(ahora.getTime() - 24 * HORA);
  if (crudo.desde !== undefined) {
    if (typeof crudo.desde !== "string") throw badRequest("`desde` tiene que ser una fecha ISO.");
    const d = new Date(crudo.desde);
    if (Number.isNaN(d.getTime())) {
      throw badRequest(`\`desde\` no es una fecha válida: "${crudo.desde}".`, {
        ejemplo_valido: "2026-08-27T00:00:00Z",
      });
    }
    desde = d;
  }

  const [acciones, leadsConector, agentes, sla, eventos] = await Promise.all([
    db.actionQueue.findMany({
      where: { status: "FAILED", createdAt: { gte: desde } },
      select: { actionType: true, error: true, finishedAt: true, attempts: true, maxAttempts: true },
    }),
    db.connectorLeadLog.findMany({
      where: { status: "ERROR", receivedAt: { gte: desde } },
      // `rawPayload` NO se selecciona: es el lead completo con sus datos personales.
      select: { errorDetail: true, receivedAt: true, connector: { select: { name: true } } },
    }),
    db.agentRun.findMany({
      where: { status: "FAILED", startedAt: { gte: desde } },
      select: { trigger: true, error: true, endedAt: true },
    }),
    db.slaTimer.groupBy({
      by: ["type"],
      where: { status: "BREACHED", breachedAt: { gte: desde } },
      _count: { _all: true },
    }),
    db.workflowEvent.groupBy({
      by: ["type"],
      where: { processedAt: null, occurredAt: { lt: new Date(ahora.getTime() - HORA) } },
      _count: { _all: true },
    }),
  ]);

  const gAcciones = agrupar(
    acciones.map((a) => ({ clave: a.actionType, error: a.error, fecha: a.finishedAt })),
  );
  const gConector = agrupar(
    leadsConector.map((l) => ({
      clave: l.connector.name,
      error: l.errorDetail,
      fecha: l.receivedAt,
    })),
  );
  /**
   * Las corridas agotadas van en su propio montón.
   *
   * Las dos salen con status FAILED —el enum no las distingue todavía— pero piden cosas
   * distintas: una que agotó su presupuesto (de pasos o de tokens) pide subirle el
   * límite o recortarle el objetivo; una que reventó pide arreglar lo que reventó.
   * Juntas, la segunda se pierde entre las primeras.
   */
  const gAgentes = agrupar(
    agentes
      .filter((r) => !esCorridaSinTerminar(r.error))
      .map((r) => ({ clave: r.trigger, error: r.error, fecha: r.endedAt })),
  );
  const gAgotadas = agrupar(
    agentes
      .filter((r) => esCorridaSinTerminar(r.error))
      .map((r) => ({ clave: r.trigger, error: r.error, fecha: r.endedAt })),
  );

  const rAcciones = recortar(gAcciones, TOPE_GRUPOS, "grupos de acciones fallidas");
  const rConector = recortar(gConector, TOPE_GRUPOS, "grupos de leads de conector con error");
  const rAgentes = recortar(gAgentes, TOPE_GRUPOS, "grupos de corridas de agente fallidas");
  const rAgotadas = recortar(gAgotadas, TOPE_GRUPOS, "grupos de corridas de agente sin terminar");

  return {
    desde: desde.toISOString(),
    /** Fallaron y ya agotaron sus reintentos: no se recuperan solas. */
    acciones_agotadas: acciones.filter((a) => a.attempts >= a.maxAttempts).length,
    acciones_fallidas: rAcciones.items,
    /**
     * 💀 El más caro del CRM: un lead que el anunciante entregó y que el sistema no supo
     * procesar. Está pagado y no llegó a ningún asesor.
     */
    leads_de_conector_perdidos: rConector.items,
    agentes_fallidos: rAgentes.items,
    /**
     * Se quedaron sin pasos antes de concluir. NO reventaron: hicieron trabajo, lo
     * dejaron a medias y hasta ahora se guardaban como «terminado bien» con el resumen
     * vacío. Un número que sube aquí significa objetivos más grandes que su presupuesto
     * de pasos, no un sistema roto.
     */
    agentes_sin_terminar: rAgotadas.items,
    sla_incumplidos_por_tipo: Object.fromEntries(sla.map((s) => [s.type, s._count._all])),
    eventos_sin_procesar_por_tipo: Object.fromEntries(eventos.map((e) => [e.type, e._count._all])),
    truncados: [rAcciones.truncado, rConector.truncado, rAgentes.truncado, rAgotadas.truncado].filter(Boolean),
    limitacion_declarada:
      "Cubre fallos de negocio (cola de acciones, conectores, agentes, SLA, eventos). NO cubre " +
      "excepciones de runtime ni 500s de Next: este repo no tiene agregador de esos. Un resultado " +
      "vacío significa «sin fallos de negocio», nunca «sin errores».",
  };
}
