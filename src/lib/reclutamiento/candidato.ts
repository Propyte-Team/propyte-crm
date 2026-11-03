// Candidato del bot sobre la tabla del módulo Reclutamiento (#926, recruit_candidates).
// Alta y lectura son best-effort (sin migrar → null); la evaluación sí propaga errores para que
// el hook los loguee.
import type { ConversationChannel, Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { askClaude } from "@/lib/bot/claude";
import { crearCandidato } from "@/server/reclutamiento";
import type { UbicacionCode } from "./shared";
import type { Evaluacion } from "./evaluar";
import { botPuedeMoverEtapa, etapaDeResultado, type Veredicto } from "./etapas";
import type { Respuestas } from "./respuestas";

/** Lo que el bot necesita saber del candidato. */
export interface CandidatoBot {
  id: string;
  stage: string;
  botResultado: Veredicto | null;
  botEvaluadoAt: Date | null;
  horarioEntrevista: string | null;
  tieneCv: boolean;
}

export interface ContactoDelBot {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
}

const NOMBRE_PROVISIONAL = "Candidato por chat";
const AREA_ASESOR = "Asesor / Ventas";
const SIN_MIGRAR = new Set(["P2021", "P2022"]);

const SELECT_BOT = {
  id: true,
  stage: true,
  botResultado: true,
  botEvaluadoAt: true,
  horarioEntrevista: true,
  files: { where: { kind: "CV", deletedAt: null }, select: { id: true }, take: 1 },
} as const;

type FilaBot = {
  id: string;
  stage: string;
  botResultado: string | null;
  botEvaluadoAt: Date | null;
  horarioEntrevista: string | null;
  files: Array<{ id: string }>;
};

function aCandidatoBot(f: FilaBot): CandidatoBot {
  return {
    id: f.id,
    stage: f.stage,
    botResultado: (f.botResultado as Veredicto | null) ?? null,
    botEvaluadoAt: f.botEvaluadoAt,
    horarioEntrevista: f.horarioEntrevista,
    tieneCv: f.files.length > 0,
  };
}

function codigo(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

async function buscarPorContacto(contactId: string): Promise<CandidatoBot | null> {
  const f = (await prisma.recruitCandidate.findFirst({
    where: { contactId, deletedAt: null },
    select: SELECT_BOT,
  })) as FilaBot | null;
  return f ? aCandidatoBot(f) : null;
}

/** Devuelve el candidato ligado al contacto; si no existe lo crea con origen CHAT. */
export async function asegurarCandidato(input: {
  contact: ContactoDelBot;
  canal: ConversationChannel;
  conversationId: string;
}): Promise<CandidatoBot | null> {
  const { contact } = input;
  try {
    const existente = await buscarPorContacto(contact.id);
    if (existente) return existente;
    const nombre = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || NOMBRE_PROVISIONAL;
    const nuevo = await crearCandidato(
      // El tipo de entrada (zod con transforms) exige todas las claves; las que el bot no conoce van en null.
      {
        fullName: nombre.slice(0, 200),
        phone: contact.phone ?? null,
        email: contact.email ?? null,
        area: AREA_ASESOR,
        age: null,
        plaza: null,
        portfolioUrl: null,
        notes: null,
        stage: undefined,
      },
      null,
      { source: "CHAT", sourceRef: input.conversationId, contactId: contact.id, botCanal: input.canal }
    );
    return { id: nuevo.id, stage: nuevo.stage, botResultado: null, botEvaluadoAt: null, horarioEntrevista: null, tieneCv: false };
  } catch (err) {
    const code = codigo(err);
    if (code === "P2002") {
      // Dos mensajes a la vez crearon el candidato: el índice único de contactId gana y releemos.
      try {
        return await buscarPorContacto(contact.id);
      } catch {
        return null;
      }
    }
    if (code && SIN_MIGRAR.has(code)) {
      console.error("[reclutamiento] recruit_candidates sin las columnas del bot (migración 2026-11-02 pendiente); el bot sigue sin evaluar");
      return null;
    }
    console.error("[reclutamiento] asegurarCandidato falló:", err);
    return null;
  }
}

/** Respuesta de plaza del guion → ubicación del módulo (#927). */
export function plazaDeRespuesta(v: string | undefined): UbicacionCode | null {
  if (v === "PDC" || v === "MERIDA") return v;
  if (v === "OTRA_CON_MUDANZA" || v === "OTRA_SIN_MUDANZA") return "FORANEO";
  return null;
}

async function resumenIA(respuestas: Respuestas, ev: Evaluacion, model: string): Promise<string | null> {
  try {
    const texto = await askClaude({
      system:
        "Resume en 2 o 3 líneas, en español y para un gerente de ventas, el perfil de este candidato a asesor inmobiliario: " +
        "experiencia, cartera, disponibilidad, plaza y lo que más pesa a favor o en contra. Sin saludos ni viñetas.",
      messages: [
        {
          role: "user",
          content: `Respuestas: ${JSON.stringify(respuestas)}\nResultado: ${ev.resultado} (${ev.puntaje}/100, motivo ${ev.motivo ?? "ninguno"})`,
        },
      ],
      maxTokens: 200,
      model,
    });
    return texto?.trim() || null;
  } catch {
    return null;
  }
}

export async function persistirEvaluacion(input: {
  candidatoId: string;
  respuestas: Respuestas;
  evaluacion: Evaluacion;
  razonesActitud: string[];
  model: string;
  /** Datos frescos del contacto para que la fila deje de decir «Candidato por chat». Solo pisa con valores no vacíos. */
  contacto?: { firstName: string | null; lastName: string | null; phone: string | null; email: string | null };
}): Promise<void> {
  const { candidatoId, respuestas, evaluacion: ev, contacto } = input;
  const resumen = await resumenIA(respuestas, ev, input.model);
  const actual = await prisma.recruitCandidate.findFirst({ where: { id: candidatoId }, select: { stage: true } });
  const plaza = plazaDeRespuesta(respuestas.plaza);
  const data: Prisma.RecruitCandidateUncheckedUpdateInput = {
    botRespuestas: respuestas as Prisma.InputJsonValue,
    botFiltros: ev.filtros as Prisma.InputJsonValue,
    botPuntaje: ev.puntaje,
    botDesglose: { ...ev.desglose, actitud_razones: input.razonesActitud } as Prisma.InputJsonValue,
    botResultado: ev.resultado,
    botMotivo: ev.motivo,
    botResumen: resumen,
    botEvaluadoAt: new Date(),
  };
  if (plaza) data.plaza = plaza;
  if (contacto) {
    const nombre = `${contacto.firstName ?? ""} ${contacto.lastName ?? ""}`.trim();
    if (nombre) data.fullName = nombre.slice(0, 200);
    if (contacto.phone?.trim()) data.phone = contacto.phone.trim();
    if (contacto.email?.trim()) data.email = contacto.email.trim();
  }
  if (actual && botPuedeMoverEtapa(actual.stage)) {
    data.stage = etapaDeResultado(ev.resultado);
    data.stageChangedAt = new Date();
  }
  await prisma.recruitCandidate.update({ where: { id: candidatoId }, data });
}

/**
 * Reserva la evaluación: marca botEvaluadoAt solo si aún está en null. Devuelve true para el
 * turno que ganó; false si otro turno ya la reclamó (o si falló la base), y ese turno no evalúa.
 * persistirEvaluacion vuelve a escribir botEvaluadoAt con el valor final.
 */
export async function reclamarEvaluacion(candidatoId: string): Promise<boolean> {
  try {
    const r = await prisma.recruitCandidate.updateMany({
      where: { id: candidatoId, botEvaluadoAt: null },
      data: { botEvaluadoAt: new Date() },
    });
    return r.count === 1;
  } catch (err) {
    console.error("[reclutamiento] no se pudo reclamar la evaluación:", err);
    return false;
  }
}

export async function guardarHorario(candidatoId: string, horario: string): Promise<void> {
  try {
    await prisma.recruitCandidate.update({ where: { id: candidatoId }, data: { horarioEntrevista: horario.slice(0, 200) } });
  } catch (err) {
    console.warn("[reclutamiento] no se pudo guardar el horario:", err);
  }
}
