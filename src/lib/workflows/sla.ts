// SlaEngine (Anexo Técnico §D.2/§D.7) — timers FIRST_TOUCH/RETRY/ORPHAN.
// Política elegida por segmento; vencimiento por minutos hábiles (excepto ORPHAN = wall-clock).
import prisma from "@/lib/db";
import { selectSlaPolicy } from "./sla-select";
import { computeDueAt, type BusinessHours } from "./business-hours";
import { mandoWhere } from "./ruteables";
import {
  destinoDelVencimiento,
  tituloDelAviso,
  mensajeDelAviso,
  explicacionSinAviso,
  type TipoDeReloj,
} from "./escalacion";

// Contexto mínimo para el DSL de condiciones (contacto + attribution + plaza del asesor).
async function loadSlaContext(contactId: string): Promise<Record<string, unknown>> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: { adAttribution: true, assignedTo: { select: { plaza: true } } },
  });
  return {
    contact,
    adAttribution: (contact as { adAttribution?: unknown } | null)?.adAttribution ?? null,
    plaza: (contact as { assignedTo?: { plaza?: unknown } } | null)?.assignedTo?.plaza ?? null,
  };
}

export async function createSlaTimer(
  contactId: string,
  type: "FIRST_TOUCH" | "RETRY" | "ORPHAN",
  dealId?: string
): Promise<void> {
  // No duplicar un timer RUNNING del mismo tipo para el mismo contacto
  const existing = await prisma.slaTimer.findFirst({
    where: { contactId, type, status: "RUNNING" },
    select: { id: true },
  });
  if (existing) return;

  const [ctx, policies] = await Promise.all([
    loadSlaContext(contactId),
    prisma.slaPolicy.findMany({ where: { isActive: true } }),
  ]);
  const policy = selectSlaPolicy(policies, ctx);

  const minutes =
    type === "FIRST_TOUCH" ? policy?.firstTouchMinutes ?? 5
    : type === "RETRY" ? policy?.retryMinutes ?? 30
    : (policy?.orphanHours ?? 24) * 60;

  const bh = type === "ORPHAN" ? null : ((policy?.businessHours as unknown as BusinessHours) ?? null);
  const dueAt = computeDueAt(new Date(), minutes, bh);

  await prisma.slaTimer.create({
    data: { contactId, dealId: dealId ?? null, policyId: policy?.id ?? null, type, dueAt },
  });
}

// Llamar SOLO cuando hay un toque SALIENTE real: llamada, WhatsApp, email o DM del
// asesor o del bot. Nunca desde un mensaje entrante.
//
// #702: hasta 2026-09-05 la segunda mitad de este comentario decía "o cuando el contacto
// responde (el contacto fue atendido)". Esa frase supone que nosotros hablamos primero,
// y es falsa para todo lead de IG/Messenger/WhatsApp, que es quien inicia. Tratar su
// primer mensaje como "fue atendido" cerraba el reloj que mide si lo atendimos: los 8
// únicos FIRST_TOUCH en MET de la historia se cumplieron entre 1.53 s y 1.87 s. Si nos
// escribió él primero, el toque que cuenta es el nuestro, y ese ya llama aquí solo.
//
// #753: filtra POR TIPO, y esa es la mitad del arreglo. Sin el filtro, este updateMany
// cerraba también el ORPHAN, que no mide lo mismo: FIRST_TOUCH y RETRY preguntan «cuánto
// tardamos en contestarle» —y un toque saliente es exactamente lo que los cumple—,
// mientras el ORPHAN pregunta «¿consiguió dueño?». Mandarle un mensaje no le asigna un
// asesor. Medido en producción el 2026-09-09: el único ORPHAN de la historia se marcó
// cumplido 11 SEGUNDOS después de abrirse, sobre un plazo de 24 horas, con un solo mensaje
// saliente, y ese contacto sigue sin dueño. La #732 acababa de sacar el Pond del
// denominador del cumplimiento para que «un lead que nadie atendió no pudiera contar como
// atención cumplida»; esto lo reintroducía por la otra puerta.
export async function meetSlaTimers(contactId: string): Promise<number> {
  const res = await prisma.slaTimer.updateMany({
    where: { contactId, status: "RUNNING", type: { in: ["FIRST_TOUCH", "RETRY"] as never } },
    data: { status: "MET", metAt: new Date() },
  });
  if (res.count > 0) {
    await prisma.contact.update({
      where: { id: contactId },
      data: { lastActivityAt: new Date() },
    }).catch(() => {});
  }
  return res.count;
}

/**
 * La otra mitad del arreglo de la #753: el reloj de la bandeja de rescate se cumple donde
 * de verdad se resuelve —cuando el contacto consigue dueño— y no con un mensaje saliente.
 *
 * Va en una función aparte y con nombre propio, en vez de un tipo más dentro de
 * `meetSlaTimers`, porque el nombre es el que dice qué la cumple. Los seis llamadores de
 * `meetSlaTimers` son caminos de salida (SMS, WhatsApp ×2, Gmail, el dispatcher del bot y
 * el eco de messaging/core); esta la llaman los DOS sitios que cambian `assignedToId`: el
 * reparto automático (`autoRouteLead`) y la asignación manual desde la bandeja
 * (`lib/inbox/assign.ts`).
 *
 * NO toca `lastActivityAt`, a diferencia de `meetSlaTimers`: que un lead consiga dueño no
 * es actividad con el cliente, y bumpearlo haría parecer atendido a alguien a quien nadie
 * le ha escrito todavía —el mismo error de fondo que esta tarjeta arregla.
 *
 * Desasignar NO vuelve a abrir el reloj. Un temporizador cumplido no se reabre en este
 * motor (no hay estado para eso) y un ORPHAN nuevo lo sella el reparto si el lead vuelve a
 * caer al Pond, que es el camino por el que un lead sin dueño se vigila de verdad.
 */
export async function cumplirOrphan(contactId: string): Promise<number> {
  const res = await prisma.slaTimer.updateMany({
    where: { contactId, status: "RUNNING", type: "ORPHAN" as never },
    data: { status: "MET", metAt: new Date() },
  });
  return res.count;
}

/**
 * #756: a quién se le avisa de un vencimiento, y el aviso en sí.
 *
 * Va aparte del bucle para que `checkSlaBreaches` siga leyéndose de un tirón, y porque esto
 * es best-effort: un fallo aquí NUNCA debe impedir que el reloj se marque, que se encadene
 * el RETRY o que se emita el evento. La dirección del fallo es la buena — perder un aviso es
 * malo, dejar de marcar vencimientos es perder el indicador entero.
 */
async function avisarDelVencimiento(timer: {
  id: string;
  contactId: string;
  type: string;
}): Promise<void> {
  const contacto = await prisma.contact.findUnique({
    where: { id: timer.contactId },
    select: {
      firstName: true,
      lastName: true,
      leadSource: true,
      targetPlaza: true,
      assignedToId: true,
      assignedTo: { select: { id: true, email: true, teamLeaderId: true, plaza: true } },
    },
  });
  if (!contacto) return;

  const asignado = contacto.assignedTo as
    | { id: string; email: string; teamLeaderId: string | null; plaza: string | null }
    | null;

  const destino = destinoDelVencimiento(timer.type as TipoDeReloj, {
    asesorId: contacto.assignedToId ?? null,
    email: asignado?.email ?? null,
    teamLeaderId: asignado?.teamLeaderId ?? null,
    // La plaza del ASESOR, no la del contacto: se escala a quien manda sobre esa persona.
    plaza: asignado?.plaza ?? null,
  });

  if (destino.a === "nadie") {
    // Se registra el motivo en vez de no hacer nada. Un aviso que no se manda y no se
    // explica es indistinguible de uno que se perdió, y esta tarjeta nace justamente de
    // que el vencimiento no dejaba rastro para una persona.
    console.warn(
      `[sla] ${timer.type} vencido en ${timer.contactId} sin avisar a nadie: ${explicacionSinAviso(destino.motivo)}`,
    );
    return;
  }

  const nombre = `${contacto.firstName} ${contacto.lastName}`.trim();
  const tipo = timer.type as TipoDeReloj;
  const base = {
    title: tituloDelAviso(tipo),
    type: "sla_breach",
    link: `/contacts/${timer.contactId}`,
  };

  if (destino.a === "asesor") {
    await prisma.notification.create({
      data: {
        ...base,
        userId: destino.usuarioId,
        message: mensajeDelAviso(tipo, nombre, contacto.leadSource, false),
      },
    });
    return;
  }

  // Escalado. Al líder de equipo si el asesor tiene uno; si no, a la gerencia de su plaza,
  // con caída a toda la gerencia — el mismo orden que `sendToPond`, para que un problema de
  // leads siempre acabe en el escritorio de alguien.
  let destinatarios: Array<{ id: string }> = [];
  if (destino.teamLeaderId) {
    destinatarios = [{ id: destino.teamLeaderId }];
  } else {
    const donde = mandoWhere();
    destinatarios = await prisma.user.findMany({
      where: { ...donde, ...(destino.plaza ? { plaza: destino.plaza as never } : {}) },
      select: { id: true },
    });
    if (destinatarios.length === 0) {
      destinatarios = await prisma.user.findMany({ where: donde, select: { id: true } });
    }
  }

  if (destinatarios.length === 0) {
    console.warn(`[sla] ${timer.type} vencido en ${timer.contactId}: no hay mando a quien escalar`);
    return;
  }

  await prisma.notification.createMany({
    data: destinatarios.map((d) => ({
      ...base,
      userId: d.id,
      message: mensajeDelAviso(tipo, nombre, contacto.leadSource, true),
    })),
  });
}

// Cron: marca BREACHED los vencidos, encadena RETRY tras FIRST_TOUCH, avisa (#756) y emite
// sla.breach.
//
// #756 — sobre repetir avisos: este barrido filtra `status: "RUNNING"` y la fila pasa a
// BREACHED en la misma iteración, así que un reloj no se vuelve a ver por más veces que
// corra el cron. Esa es toda la idempotencia que hace falta hoy, y hay una prueba que la
// fija: si algún día algo devuelve un timer a RUNNING, el aviso se duplicaría y conviene que
// la prueba lo diga antes que el usuario.
export async function checkSlaBreaches(limit = 100): Promise<number> {
  const due = await prisma.slaTimer.findMany({
    where: { status: "RUNNING", dueAt: { lte: new Date() } },
    take: limit,
  });

  const { emitEvent } = await import("./events");
  for (const timer of due) {
    await prisma.slaTimer.update({
      where: { id: timer.id },
      data: { status: "BREACHED", breachedAt: new Date() },
    });
    // Best-effort y NUNCA antes de marcar: si el aviso tumbara el barrido, un fallo de la
    // tabla de notificaciones dejaría de marcar vencimientos, que es peor que no avisar.
    await avisarDelVencimiento(timer).catch((err) =>
      console.error(`[sla] no se pudo avisar del vencimiento de ${timer.id}:`, err),
    );
    await emitEvent("sla.breach", "contact", timer.contactId, {
      timerType: timer.type,
      dueAt: timer.dueAt.toISOString(),
    });
    // Cadena: FIRST_TOUCH vencido → arranca RETRY (reintento 30 min, P2)
    if (timer.type === "FIRST_TOUCH") {
      await createSlaTimer(timer.contactId, "RETRY", timer.dealId ?? undefined);
    }
  }
  return due.length;
}
