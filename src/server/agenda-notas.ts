// ============================================================
// Notas de una reunión o llamada de la Agenda (HUB #860)
// Una nota es una actividad NOTE con `parentActivityId` = la cita. Hereda el contacto y el
// negocio de la cita, así que también aparece en la ficha del contacto y en "Notas recientes".
// ============================================================

import prisma from "@/lib/db";
import type { ActivityType } from "@prisma/client";
import { getServerSession } from "@/lib/auth/session";
import { canModifyActivity } from "@/lib/activities/permissions";
import { createActivity } from "@/server/activities";

const CITA_TYPES: ActivityType[] = [
  "MEETING_VIRTUAL",
  "MEETING_PRESENTIAL",
  "MEETING_SHOWROOM",
  "CALL_OUTBOUND",
  "CALL_INBOUND",
];

/** Tope de notas devueltas por cita. */
const NOTAS_TAKE = 100;
const SUBJECT_MAX = 200;

export interface CitaNota {
  id: string;
  texto: string;
  createdAt: string; // ISO 8601
  autor: string | null;
}

/** La cita existe, es reunión o llamada, y quien pregunta es su dueño o tiene rol para tocarla. */
async function citaAccesible(citaId: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const cita = await prisma.activity.findUnique({
    where: { id: citaId, deletedAt: null },
    select: { id: true, userId: true, activityType: true, subject: true, contactId: true, dealId: true },
  });
  if (!cita || !CITA_TYPES.includes(cita.activityType)) {
    throw new Error("Reunión o llamada no encontrada");
  }
  if (!canModifyActivity(session.user.role, cita.userId === session.user.id)) {
    throw new Error("No tienes permiso para ver las notas de esta actividad");
  }
  return cita;
}

export async function getCitaNotas(citaId: string): Promise<CitaNota[]> {
  await citaAccesible(citaId);

  const rows = await prisma.activity.findMany({
    where: { parentActivityId: citaId, activityType: "NOTE", deletedAt: null },
    select: {
      id: true,
      subject: true,
      description: true,
      createdAt: true,
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: NOTAS_TAKE,
  });

  return rows.map((r) => ({
    id: r.id,
    texto: r.description ?? r.subject,
    createdAt: r.createdAt.toISOString(),
    autor: r.user?.name ?? null,
  }));
}

export async function addCitaNota(citaId: string, texto: string): Promise<CitaNota> {
  const cita = await citaAccesible(citaId);

  // El asunto identifica la nota fuera de la cita (ficha del contacto, "Notas recientes").
  const subject = `Nota: ${cita.subject}`.slice(0, SUBJECT_MAX);

  const nota = await createActivity({
    activityType: "NOTE",
    subject,
    description: texto,
    contactId: cita.contactId ?? undefined,
    dealId: cita.dealId ?? undefined,
    parentActivityId: cita.id,
  });

  return {
    id: nota.id,
    texto,
    createdAt: nota.createdAt.toISOString(),
    autor: nota.user?.name ?? null,
  };
}
