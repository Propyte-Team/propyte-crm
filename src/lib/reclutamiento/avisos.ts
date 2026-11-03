// Qué pasa al fijar el resultado (spec §7). Nunca lanza: perder un aviso es malo, romper la
// respuesta del bot es peor.
import type { Plaza } from "@prisma/client";
import prisma from "@/lib/db";
import { emitEvent } from "@/lib/workflows/events";
import { gerenciaDeLaPlaza } from "@/lib/workflows/gerencia";
import { usuarioRuteableWhere } from "@/lib/workflows/ruteables";
import type { ResponsablesReclutamiento } from "./modelo";
import type { UbicacionCode } from "./shared";
import type { Veredicto } from "./etapas";

const DOS_DIAS_HABILES_MS = 2 * 24 * 60 * 60 * 1000;

// La ubicación del candidato (#927) es más amplia que la plaza del CRM: la gerencia solo
// existe para estas tres.
const PLAZAS_CRM: readonly string[] = ["PDC", "TULUM", "MERIDA"];
function esPlazaCrm(p: string): p is Plaza {
  return PLAZAS_CRM.includes(p);
}

/** Orden: configuración de la plaza → gerencia de la plaza → default configurado → ADMIN personas. */
export async function responsablesDe(plaza: UbicacionCode | null, cfg: ResponsablesReclutamiento): Promise<string[]> {
  if (plaza === "PDC" || plaza === "MERIDA") {
    if (cfg[plaza]?.length) return cfg[plaza]!;
  }
  if (plaza && esPlazaCrm(plaza)) {
    const gerencia = await gerenciaDeLaPlaza(plaza).catch(() => [] as string[]);
    if (gerencia.length > 0) return gerencia;
  }
  if (cfg.default?.length) return cfg.default;
  try {
    const admins = await prisma.user.findMany({ where: { ...usuarioRuteableWhere(), role: "ADMIN" }, select: { id: true } });
    return admins.map((a) => a.id);
  } catch {
    return [];
  }
}

export async function avisarResultado(input: {
  candidatoId: string;
  contactId: string;
  conversationId: string;
  nombre: string;
  plaza: UbicacionCode | null;
  puntaje: number;
  resultado: Veredicto;
  responsables: string[];
}): Promise<void> {
  const { resultado, responsables } = input;
  const link = `/inbox?c=${input.conversationId}`;
  const plazaTxt = input.plaza ?? "sin plaza";
  // Para que el gerente sepa dónde ver el perfil completo del candidato.
  const ficha = " · Ficha: /reclutamiento";
  try {
    if (resultado === "APTO" && responsables.length > 0) {
      await prisma.activity.create({
        data: {
          userId: responsables[0],
          contactId: input.contactId,
          activityType: "TASK",
          subject: `Entrevistar candidato ${input.nombre} — ${plazaTxt}`.slice(0, 200),
          description: `El bot evaluó al candidato como APTO (${input.puntaje}/100). Conversación: ${link}${ficha}`,
          dueDate: new Date(Date.now() + DOS_DIAS_HABILES_MS),
          status: "PENDIENTE",
        },
      });
    }
    if ((resultado === "APTO" || resultado === "REVISAR") && responsables.length > 0) {
      const titulo = resultado === "APTO" ? "Candidato apto para entrevista" : "Candidato por revisar";
      await prisma.notification.createMany({
        data: responsables.map((userId) => ({
          userId,
          title: titulo,
          message: `${input.nombre} (${plazaTxt}) — ${input.puntaje}/100${ficha}`,
          type: resultado === "APTO" ? "recruitment_apto" : "recruitment_revisar",
          link,
        })),
      });
    }
  } catch (err) {
    console.error("[reclutamiento] aviso del resultado falló:", err);
  }
  try {
    const tipo = resultado === "APTO" ? "recruitment.apto" : resultado === "REVISAR" ? "recruitment.revisar" : "recruitment.no_apto";
    await emitEvent(tipo, "contact", input.contactId, {
      candidatoId: input.candidatoId,
      puntaje: input.puntaje,
      plaza: input.plaza,
      conversationId: input.conversationId,
    });
  } catch (err) {
    console.error("[reclutamiento] emitEvent del resultado falló:", err);
  }
}
