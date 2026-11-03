// Punto de enganche del bot con el reclutamiento (spec §4.5, §5.2, §7). Lo llama botRespond
// cuando el agente resuelto es «Agente Reclutamiento». Devuelve, opcionalmente, un objetivo
// de cierre que reemplaza al del playbook y un contexto (la ficha de la vacante). Nunca lanza.
import type { ConversationChannel, PlaybookRunStatus } from "@prisma/client";
import type { BotMessage } from "@/lib/bot/claude";
import prisma from "@/lib/db";
import { extractFields } from "@/lib/bot/playbook/extract";
import { evaluarActitud } from "./actitud";
import {
  asegurarCandidato,
  guardarHorario,
  persistirEvaluacion,
  plazaDeRespuesta,
  reclamarEvaluacion,
  sincronizarCandidato,
  type ContactoDelBot,
} from "./candidato";
import type { Veredicto } from "./etapas";
import { evaluar } from "./evaluar";
import { desarrollosParaReclutamiento } from "@/lib/hub/reclutamiento-inventario";
import { construirFicha } from "./ficha";
import { cargarConfigReclutamiento } from "./modelo";
import { leerRespuestas } from "./respuestas";
import { avisarResultado, responsablesDe } from "./avisos";

export const NOMBRE_AGENTE_RECLUTAMIENTO = "Agente Reclutamiento";

export function esAgenteReclutamiento(agente: { name: string } | null | undefined): boolean {
  return agente?.name === NOMBRE_AGENTE_RECLUTAMIENTO;
}

// Decisiones 2026-11-03: «Gerente de Ventas» (no «gerente de la plaza»); el contacto es por WhatsApp al
// número capturado, no «por este chat»; el CV puede ser enlace porque Instagram no manda archivos.
const PIDE_CV =
  "Pide su CV: como archivo PDF o Word si puede adjuntarlo, o un enlace (Drive, Dropbox) si el canal no permite archivos.";
const CONTACTO_WHATSAPP = "Dile que el Gerente de Ventas lo contacta por WhatsApp al número que dejó.";

export const OBJETIVOS_CIERRE = {
  APTO_SIN_CV:
    "El candidato quedó APTO. Felicítalo en una línea y dile por qué encaja (sin números ni criterios). " +
    PIDE_CV + " Pregúntale qué días y horario le acomodan para una entrevista con el Gerente de Ventas. " + CONTACTO_WHATSAPP,
  APTO_CON_CV:
    "El candidato quedó APTO y ya mandó su CV. Felicítalo en una línea, agradece el CV y pregúntale qué días y horario le acomodan para una entrevista con el Gerente de Ventas. " +
    CONTACTO_WHATSAPP,
  APTO_HORARIO_GUARDADO:
    "Ya tienes su horario preferido. Confírmalo en una línea, dile que el Gerente de Ventas lo contacta por WhatsApp al número que dejó para fijar la entrevista y despídete con calidez. Si pregunta algo más, responde breve.",
  REVISAR_SIN_CV:
    "El equipo va a revisar su perfil. Agradécele. " + PIDE_CV + " Dile que el Gerente de Ventas lo contacta por WhatsApp al número que dejó en dos días hábiles. No prometas entrevista.",
  REVISAR_CON_CV:
    "El equipo va a revisar su perfil. Agradécele el CV y dile que el Gerente de Ventas lo contacta por WhatsApp al número que dejó en dos días hábiles. No prometas entrevista.",
  NO_APTO:
    "Hoy el perfil no coincide con lo que busca el equipo. Agradécele con tacto, dilo sin listar criterios ni motivos, deja la puerta abierta para más adelante y despídete. No ofrezcas entrevista ni pidas CV. " +
    "Si después pregunta algo más, responde breve y amable sin reabrir la evaluación.",
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

type ContactoConCustom = ContactoDelBot & { custom: unknown };

/**
 * Relee el contacto. botRespond lo carga antes de correr el playbook, y runPlaybookStep guarda las
 * capturas del turno en la base: sin releer, la evaluación no vería las últimas respuestas (al menos
 * actitud_3) y fallaría filtros como AMBIGUO. Si la lectura falla, se usa lo que llegó.
 */
async function recargarContacto(c: ContactoConCustom): Promise<ContactoConCustom> {
  try {
    const f = await prisma.contact.findUnique({
      where: { id: c.id },
      select: { firstName: true, lastName: true, phone: true, email: true, custom: true },
    });
    return f ? { id: c.id, ...f } : c;
  } catch (err) {
    console.warn("[reclutamiento] no se pudo releer el contacto; se evalúa con el cargado al inicio:", err);
    return c;
  }
}

/**
 * Contexto mientras el guion sigue (prueba 2026-11-03: el modelo cerró la charla y pidió el CV por su
 * cuenta cuando una respuesta no casó con el enum). Las reglas van ANTES de la ficha para que pesen más.
 */
export function contextoEnCurso(ficha: string): string {
  return (
    "Reglas del guion: estás en medio de una entrevista por chat. NO cierres la conversación, NO pidas CV, " +
    "NO ofrezcas ni prometas entrevista y NO des por terminado nada hasta que el sistema te lo indique. " +
    "Si el candidato pregunta algo o se desvía, contesta breve con la ficha y retoma la pregunta pendiente en el mismo mensaje. " +
    "Si una respuesta no fue clara, vuelve a preguntar de otra forma. " +
    "Solo describe productos y oficinas con la ficha; no inventes desarrollos. " +
    `Ficha de la vacante: ${ficha}`
  );
}

/**
 * Copia a la ficha lo que el bot ya sabe (contacto fresco + respuestas del guion). Se hace en cada
 * turno para que /reclutamiento muestre teléfono y respuestas aunque el guion nunca termine.
 */
async function sincronizarFicha(candidatoId: string, contacto: ContactoConCustom): Promise<void> {
  await sincronizarCandidato({
    candidatoId,
    contacto: { firstName: contacto.firstName, lastName: contacto.lastName, phone: contacto.phone, email: contacto.email },
    respuestas: leerRespuestas(contacto.custom),
  });
}

export interface ResultadoHook {
  /** Reemplaza el objetivo del playbook cuando hay cierre. */
  objetivo?: string;
  /** Texto que se suma a la capa de objetivo (ficha de la vacante) mientras el guion sigue. */
  contexto?: string;
}

export async function hookReclutamiento(input: {
  contact: ContactoConCustom;
  conversationId: string;
  channel: ConversationChannel;
  model: string;
  messages: BotMessage[];
  playbook: { status: PlaybookRunStatus };
}): Promise<ResultadoHook> {
  try {
    const cand = await asegurarCandidato({ contact: input.contact, canal: input.channel, conversationId: input.conversationId });
    if (!cand) return {};

    // Ya evaluado: el bot no vuelve a evaluar solo. Si es APTO y falta horario, lo intenta capturar.
    if (cand.botEvaluadoAt !== null) {
      await sincronizarFicha(cand.id, await recargarContacto(input.contact));
      if (cand.botResultado === "APTO" && !cand.horarioEntrevista) {
        // Solo el último mensaje: ahorra tokens y evita rescatar texto viejo de la charla.
        const ext = await extractFields({
          messages: input.messages.slice(-1),
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

    const cfg = await cargarConfigReclutamiento();
    if (cfg.errorModelo) console.warn(`[reclutamiento] reclutamiento.modelo inválido, se usa el default: ${cfg.errorModelo}`);

    if (input.playbook.status !== "COMPLETED") {
      await sincronizarFicha(cand.id, await recargarContacto(input.contact));
      // Ficha = base (SystemConfig o default) + oficinas + desarrollos del Hub (nunca lanza; sin Hub → solo base).
      return { contexto: contextoEnCurso(construirFicha(cfg.ficha, await desarrollosParaReclutamiento())) };
    }

    // Playbook completo → evaluar. Dos mensajes casi simultáneos entrarían aquí a la vez:
    // solo evalúa el turno que reserva la evaluación; el otro no hace nada y en su siguiente
    // turno tomará el camino de «ya evaluado».
    if (!(await reclamarEvaluacion(cand.id))) return {};
    const contacto = await recargarContacto(input.contact);
    const respuestas = leerRespuestas(contacto.custom);
    const actitud = await evaluarActitud(respuestas, input.model);
    const ev = evaluar({ respuestas, actitudPuntos: actitud?.puntos ?? null, cvRecibido: cand.tieneCv, modelo: cfg.modelo });
    await persistirEvaluacion({
      candidatoId: cand.id,
      respuestas,
      evaluacion: ev,
      razonesActitud: actitud?.razones ?? [],
      model: input.model,
      contacto: { firstName: contacto.firstName, lastName: contacto.lastName, phone: contacto.phone, email: contacto.email },
    });

    const plaza = plazaDeRespuesta(respuestas.plaza);
    const responsables = await responsablesDe(plaza, cfg.responsables);
    await avisarResultado({
      candidatoId: cand.id,
      contactId: input.contact.id,
      conversationId: input.conversationId,
      nombre: `${contacto.firstName} ${contacto.lastName}`.trim(),
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
