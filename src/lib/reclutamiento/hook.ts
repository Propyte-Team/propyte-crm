// Punto de enganche del bot con el reclutamiento (spec §4.5, §5.2, §7). Lo llama botRespond
// cuando el agente resuelto es «Agente Reclutamiento». Devuelve, opcionalmente, un objetivo
// de cierre que reemplaza al del playbook y un contexto (la ficha de la vacante). Nunca lanza.
import type { ConversationChannel, PlaybookRunStatus } from "@prisma/client";
import type { BotMessage } from "@/lib/bot/claude";
import { extractFields } from "@/lib/bot/playbook/extract";
import { evaluarActitud } from "./actitud";
import { asegurarCandidato, guardarHorario, persistirEvaluacion, plazaDeRespuesta, type ContactoDelBot } from "./candidato";
import type { Veredicto } from "./etapas";
import { evaluar } from "./evaluar";
import { cargarConfigReclutamiento } from "./modelo";
import { leerRespuestas } from "./respuestas";
import { avisarResultado, responsablesDe } from "./avisos";

export const NOMBRE_AGENTE_RECLUTAMIENTO = "Agente Reclutamiento";

export function esAgenteReclutamiento(agente: { name: string } | null | undefined): boolean {
  return agente?.name === NOMBRE_AGENTE_RECLUTAMIENTO;
}

export const OBJETIVOS_CIERRE = {
  APTO_SIN_CV:
    "El candidato quedó APTO. Felicítalo en una línea y dile por qué encaja (sin números ni criterios). " +
    "Pídele su CV (PDF o Word, aquí mismo) y pregúntale qué días y horario le acomodan para una entrevista con el gerente de la plaza. Dile que el gerente lo contacta.",
  APTO_CON_CV:
    "El candidato quedó APTO y ya mandó su CV. Felicítalo en una línea, agradece el CV y pregúntale qué días y horario le acomodan para una entrevista con el gerente de la plaza. Dile que el gerente lo contacta.",
  APTO_HORARIO_GUARDADO:
    "Ya tienes su horario preferido. Confírmalo en una línea, dile que el gerente de la plaza lo contacta para fijar la entrevista y despídete con calidez. Si pregunta algo más, responde breve.",
  REVISAR_SIN_CV:
    "El equipo va a revisar su perfil. Agradécele, pídele su CV (PDF o Word, aquí mismo) y dile que lo contactan en dos días hábiles. No prometas entrevista.",
  REVISAR_CON_CV:
    "El equipo va a revisar su perfil. Agradécele el CV y dile que lo contactan en dos días hábiles. No prometas entrevista.",
  NO_APTO:
    "Hoy el perfil no coincide con lo que busca el equipo. Agradécele con tacto, dilo sin listar criterios ni motivos, deja la puerta abierta para más adelante y despídete. No ofrezcas entrevista ni pidas CV.",
} as const;

function cierreDe(c: { botResultado: Veredicto | null; tieneCv: boolean; horarioEntrevista: string | null }): string | undefined {
  switch (c.botResultado) {
    case "APTO":
      if (c.horarioEntrevista) return OBJETIVOS_CIERRE.APTO_HORARIO_GUARDADO;
      return c.tieneCv ? OBJETIVOS_CIERRE.APTO_CON_CV : OBJETIVOS_CIERRE.APTO_SIN_CV;
    case "REVISAR":
      return c.tieneCv ? OBJETIVOS_CIERRE.REVISAR_CON_CV : OBJETIVOS_CIERRE.REVISAR_SIN_CV;
    case "NO_APTO":
      return OBJETIVOS_CIERRE.NO_APTO;
    default:
      return undefined;
  }
}

export interface ResultadoHook {
  /** Reemplaza el objetivo del playbook cuando hay cierre. */
  objetivo?: string;
  /** Texto que se suma a la capa de objetivo (ficha de la vacante) mientras el guion sigue. */
  contexto?: string;
}

export async function hookReclutamiento(input: {
  contact: ContactoDelBot & { custom: unknown };
  conversationId: string;
  channel: ConversationChannel;
  model: string;
  messages: BotMessage[];
  playbook: { status: PlaybookRunStatus };
}): Promise<ResultadoHook> {
  try {
    const cand = await asegurarCandidato({ contact: input.contact, canal: input.channel, conversationId: input.conversationId });
    if (!cand) return {};
    const cfg = await cargarConfigReclutamiento();
    if (cfg.errorModelo) console.warn(`[reclutamiento] reclutamiento.modelo inválido, se usa el default: ${cfg.errorModelo}`);

    // Ya evaluado: el bot no vuelve a evaluar solo. Si es APTO y falta horario, lo intenta capturar.
    if (cand.botEvaluadoAt !== null) {
      if (cand.botResultado === "APTO" && !cand.horarioEntrevista) {
        const ext = await extractFields({
          messages: input.messages,
          model: input.model,
          tasks: [{ key: "horario_entrevista", captureType: "TEXT", objective: "Qué días y horario le acomodan para la entrevista." }],
        });
        const h = ext.horario_entrevista;
        if (typeof h === "string" && h.trim()) {
          await guardarHorario(cand.id, h.trim());
          return { objetivo: OBJETIVOS_CIERRE.APTO_HORARIO_GUARDADO };
        }
      }
      return { objetivo: cierreDe(cand) };
    }

    if (input.playbook.status !== "COMPLETED") {
      return { contexto: `Ficha de la vacante (úsala solo si el candidato pregunta por sueldo, comisiones, horario o la empresa; luego retoma): ${cfg.ficha}` };
    }

    // Playbook completo → evaluar.
    const respuestas = leerRespuestas(input.contact.custom);
    const actitud = await evaluarActitud(respuestas, input.model);
    const ev = evaluar({ respuestas, actitudPuntos: actitud?.puntos ?? null, cvRecibido: cand.tieneCv, modelo: cfg.modelo });
    await persistirEvaluacion({ candidatoId: cand.id, respuestas, evaluacion: ev, razonesActitud: actitud?.razones ?? [], model: input.model });

    const plaza = plazaDeRespuesta(respuestas.plaza);
    const responsables = await responsablesDe(plaza, cfg.responsables);
    await avisarResultado({
      candidatoId: cand.id,
      contactId: input.contact.id,
      conversationId: input.conversationId,
      nombre: `${input.contact.firstName} ${input.contact.lastName}`.trim(),
      plaza,
      puntaje: ev.puntaje,
      resultado: ev.resultado,
      responsables,
    });

    return { objetivo: cierreDe({ botResultado: ev.resultado, tieneCv: cand.tieneCv, horarioEntrevista: null }) };
  } catch (err) {
    console.error("[reclutamiento] hook falló; el bot sigue con el playbook:", err);
    return {};
  }
}
