/**
 * Reasignación por falta de primer contacto (etapa `slaReasignacion` del cron de workflows).
 *
 * Un lead que el reparto le dio a un asesor y que no recibe primer contacto en el plazo
 * configurado pasa al siguiente del turno, con su propio plazo completo. Las reglas y los
 * textos están en `sla-reasignacion-model.ts`; aquí solo se lee y se escribe.
 *
 * Qué NO se reasigna, a propósito:
 *  - leads que alguien asignó a mano (el último cambio de asesor no vino del reparto);
 *  - leads cuyo dueño no es asesor (un gerente, un director, Luis): el reparto no los eligió;
 *  - leads con cualquier rastro de contacto desde la asignación: mensaje saliente de un
 *    asesor o actividad de contacto registrada (incluye llamadas anotadas a mano);
 *  - leads que ya pasaron `maxReasignaciones` veces por esta regla: ahí el problema ya no es
 *    de un asesor, y lo sigue el escalamiento del SLA (aviso al líder con el RETRY);
 *  - leads asignados antes de encender la regla.
 * Si no hay otro asesor que pueda recibirlo, el lead se queda donde está (nunca va al Pond).
 */
import prisma from "@/lib/db";
import { autoRouteLead } from "./routing";
import { ROLES_RUTEABLES } from "./ruteables";
import {
  CLAVE_REASIGNACION,
  ORIGEN_REASIGNACION,
  ORIGENES_DE_REPARTO,
  TIPOS_DE_CONTACTO,
  avisoAlAnterior,
  estadoDelPlazo,
  leerConfigReasignacion,
  motivoDelReparto,
  venceReasignacion,
} from "./sla-reasignacion-model";

/** Por qué un lead revisado no se reasignó. Viaja en el resultado del tick del cron. */
export type MotivoOmision =
  | "reloj_reemplazado"
  | "sin_dueno"
  | "dueno_no_asesor"
  | "asignado_a_mano"
  | "ya_contactado"
  | "tope_de_reasignaciones"
  | "sin_otro_asesor"
  | "error";

export type ResultadoReasignacion = {
  revisados: number;
  reasignados: number;
  omitidos: Partial<Record<MotivoOmision, number>>;
};

/** Holgura entre el cambio de asesor y la creación del reloj (los escribe el reparto seguidos). */
const HOLGURA_MS = 5 * 60_000;
/** El plazo más largo permitido (24 h hábiles) cabe de sobra en una semana de calendario. */
const BUSQUEDA_MS = 7 * 24 * 60 * 60_000;

export async function reasignarSinPrimerContacto(
  limite = 50,
  ahora: Date = new Date(),
): Promise<ResultadoReasignacion> {
  const resultado: ResultadoReasignacion = { revisados: 0, reasignados: 0, omitidos: {} };
  const omitir = (m: MotivoOmision) => {
    resultado.omitidos[m] = (resultado.omitidos[m] ?? 0) + 1;
  };

  const fila = await prisma.systemConfig.findUnique({ where: { key: CLAVE_REASIGNACION } });
  const cfg = leerConfigReasignacion(fila?.value);
  if (!cfg.activo) return resultado;

  const encendida = cfg.activoDesde ? new Date(cfg.activoDesde) : (fila?.updatedAt ?? ahora);
  const desde = new Date(Math.max(encendida.getTime(), ahora.getTime() - BUSQUEDA_MS));

  const relojes = await prisma.slaTimer.findMany({
    where: {
      type: "FIRST_TOUCH",
      status: { in: ["RUNNING", "BREACHED"] as never },
      metAt: null,
      createdAt: { gte: desde },
    },
    select: { id: true, contactId: true, createdAt: true, policy: { select: { businessHours: true } } },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  // El plazo se calcula aquí y no en SQL (depende del horario laboral), así que se filtra
  // antes de gastar consultas en cada lead.
  const vencidos = relojes
    .filter((r) => estadoDelPlazo(venceReasignacion(r.createdAt, cfg.minutosHabiles, r.policy?.businessHours), ahora) === "vencido")
    .slice(0, limite);

  const errores: string[] = [];
  for (const reloj of vencidos) {
    resultado.revisados++;
    try {
      const motivo = await reasignarUno(reloj, cfg.minutosHabiles, cfg.maxReasignaciones);
      if (motivo === "reasignado") resultado.reasignados++;
      else omitir(motivo);
    } catch (err) {
      // Un lead que falla no detiene a los demás; al final se reporta para que el cron lo vea.
      omitir("error");
      errores.push(`${reloj.contactId}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[sla-reasignacion] no se pudo revisar el lead ${reloj.contactId}:`, err);
    }
  }

  if (errores.length > 0) {
    throw new Error(`reasignación por primer contacto: ${errores.length} con error (${errores.join("; ")})`);
  }
  return resultado;
}

async function reasignarUno(
  reloj: { id: string; contactId: string; createdAt: Date },
  minutosHabiles: number,
  maxReasignaciones: number,
): Promise<MotivoOmision | "reasignado"> {
  const { contactId, createdAt: asignadoEn } = reloj;

  // Si hay un FIRST_TOUCH más nuevo, este reloj ya no es del dueño actual.
  const masNuevo = await prisma.slaTimer.findFirst({
    where: { contactId, type: "FIRST_TOUCH", createdAt: { gt: asignadoEn } },
    select: { id: true },
  });
  if (masNuevo) return "reloj_reemplazado";

  const contacto = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      deletedAt: true,
      firstName: true,
      lastName: true,
      leadSource: true,
      assignedToId: true,
      assignedTo: { select: { id: true, role: true, teamLeaderId: true } },
    },
  });
  if (!contacto || contacto.deletedAt || !contacto.assignedToId || !contacto.assignedTo) return "sin_dueno";
  if (!(ROLES_RUTEABLES as readonly string[]).includes(contacto.assignedTo.role)) return "dueno_no_asesor";

  const ultimoCambio = await prisma.recordFieldChange.findFirst({
    where: { entityType: "contact", entityId: contactId, field: "assignedToId" },
    orderBy: { changedAt: "desc" },
    select: { source: true, changedAt: true },
  });
  const delReparto =
    !!ultimoCambio &&
    (ORIGENES_DE_REPARTO as readonly string[]).includes(ultimoCambio.source ?? "") &&
    ultimoCambio.changedAt.getTime() <= asignadoEn.getTime() + HOLGURA_MS;
  if (!delReparto) return "asignado_a_mano";

  const [actividad, mensaje] = await Promise.all([
    prisma.activity.findFirst({
      where: {
        contactId,
        activityType: { in: [...TIPOS_DE_CONTACTO] as never },
        status: { not: "CANCELADA" as never },
        createdAt: { gte: asignadoEn },
      },
      select: { id: true },
    }),
    prisma.message.findFirst({
      where: {
        contactId,
        direction: "OUTBOUND" as never,
        sender: "ADVISOR" as never,
        internalNote: false,
        createdAt: { gte: asignadoEn },
      },
      select: { id: true },
    }),
  ]);
  if (actividad || mensaje) return "ya_contactado";

  const anteriores = await prisma.recordFieldChange.findMany({
    where: { entityType: "contact", entityId: contactId, field: "assignedToId", source: ORIGEN_REASIGNACION },
    select: { oldValue: true },
  });
  if (anteriores.length >= maxReasignaciones) return "tope_de_reasignaciones";

  const anterior = contacto.assignedToId;
  // Ni el dueño actual ni quien ya lo perdió por esta misma regla: el turno no se lo devuelve.
  const excluir = [
    anterior,
    ...anteriores.map((a) => a.oldValue).filter((v): v is string => typeof v === "string"),
  ];

  const nuevo = await autoRouteLead(contactId, {
    reason: motivoDelReparto(minutosHabiles),
    excluirUserIds: excluir,
    sinPond: true,
    source: ORIGEN_REASIGNACION,
    reiniciarPrimerContacto: true,
  });
  if (!nuevo) return "sin_otro_asesor";

  // Best-effort: el lead ya cambió de dueño; perder este aviso no debe deshacerlo ni tumbar
  // el barrido. Va al asesor que lo perdió y a su líder (si no es quien lo recibió).
  const nombre = `${contacto.firstName} ${contacto.lastName}`.trim();
  const aviso = avisoAlAnterior(nombre, String(contacto.leadSource), minutosHabiles);
  const destinatarios = [anterior, contacto.assignedTo.teamLeaderId].filter(
    (id, i, todos): id is string => !!id && id !== nuevo && todos.indexOf(id) === i,
  );
  if (destinatarios.length > 0) {
    await prisma.notification
      .createMany({
        data: destinatarios.map((userId) => ({
          userId,
          ...aviso,
          type: "lead_reasignado_sla",
          link: `/contacts/${contactId}`,
        })),
      })
      .catch((err) => console.error(`[sla-reasignacion] no se pudo avisar de la reasignación de ${contactId}:`, err));
  }
  return "reasignado";
}
