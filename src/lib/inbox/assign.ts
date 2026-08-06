// src/lib/inbox/assign.ts
// Asignación de conversaciones (spec 2026-08-06): el dueño vive en
// Contact.assignedToId — asignar en el inbox = asignar el contacto en todo el CRM.
// Permisos ADENTRO del módulo (la ruta solo mapea códigos a HTTP):
//   mando (INBOX_MANAGERS) → asigna / reasigna / quita a cualquier usuario válido
//   no-mando → solo claim: a sí mismo, solo si el contacto está libre, y solo si su
//              propio rol puede ser dueño de un contacto (canOwnInboxContact)
// En ambos casos el ASIGNADO final también debe poder ser dueño (mismo gate) —
// el mando no puede colgarle un lead a un rol que no lo atiende (p.ej. HOSTESS).
import prisma from "@/lib/db";
import { withChangeSource } from "@/lib/audit/change-context";
import { isInboxManager, canOwnInboxContact } from "./roles";

export const ASSIGN_NOTIFICATION_TYPE = "conversation_assigned";

export type AssignResult =
  | { ok: true; assignedTo: { id: string; name: string } | null }
  | { ok: false; code: "sin-permiso" | "ya-asignado" | "no-existe" | "usuario-invalido" | "conflicto" };

export async function assignContact(opts: {
  contactId: string;
  assigneeId: string | null;
  actor: { id: string; role: string };
  conversationId?: string | null;
  source?: "inbox_assign" | "inbox_autoclaim";
}): Promise<AssignResult> {
  const { contactId, assigneeId, actor } = opts;

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, deletedAt: null },
    select: { id: true, assignedToId: true, updatedAt: true, firstName: true, lastName: true },
  });
  if (!contact) return { ok: false, code: "no-existe" };

  const manager = isInboxManager(actor.role);
  if (!manager) {
    // No-mando: solo claim, y solo si el ROL del actor puede ser dueño de un contacto.
    // Sin este check, un rol como HOSTESS/MARKETING podía "reclamar" mandando su propio
    // id — el gate genérico de la ruta ya no los detiene porque assign se resuelve antes.
    if (!canOwnInboxContact(actor.role)) return { ok: false, code: "sin-permiso" };
    // Solo claim a sí mismo. Si el dueño actual es OTRO → sin cupo (ya-asignado).
    // Si el dueño actual ES el actor, se deja pasar: el guard de idempotencia de abajo
    // (válido para cualquier rol) lo resuelve sin escribir.
    if (assigneeId !== actor.id) return { ok: false, code: "sin-permiso" };
    if (contact.assignedToId !== null && contact.assignedToId !== actor.id) {
      return { ok: false, code: "ya-asignado" };
    }
  }

  // Validar al asignado: activo, sin email .local (los usuarios QA no reciben leads ni
  // a mano — espíritu del gate anti-test AUD-09 del routing) y con un ROL que pueda ser
  // dueño de un contacto — el mando tampoco puede colgarle un lead a HOSTESS/MARKETING.
  let assignee: { id: string; name: string } | null = null;
  if (assigneeId !== null) {
    const user = await prisma.user.findFirst({
      where: { id: assigneeId, isActive: true, deletedAt: null },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!user || user.email.endsWith(".local") || !canOwnInboxContact(user.role)) {
      return { ok: false, code: "usuario-invalido" };
    }
    assignee = { id: user.id, name: user.name };
  }

  // Idempotencia unificada (cualquier rol, no solo claim; incluye desasignar sobre un
  // contacto YA libre): el destino ya es el dueño actual → ok sin escribir ni disparar
  // side-effects (evita spam en doble submit y bumps de updatedAt que invalidarían locks
  // optimistas en vuelo de otros). Va DESPUÉS del bloque de permisos a propósito: si
  // corriera antes, un no-mando podría "reasignar" con éxito un contacto que ya es de
  // un tercero, filtrando el nombre de ese tercero sin tener permiso real.
  if (contact.assignedToId === assigneeId) {
    return { ok: true, assignedTo: assignee };
  }

  // Escritura con lock optimista sobre el updatedAt leído: si el contacto cambió
  // entre lectura y update (otro claim ganó), el update no matchea → conflicto.
  try {
    await withChangeSource(
      { source: opts.source ?? "inbox_assign", actorId: actor.id },
      (tx) =>
        tx.contact.update({
          where: { id: contact.id, updatedAt: contact.updatedAt },
          data: { assignedToId: assigneeId },
        })
    );
  } catch (e) {
    // Solo el miss del lock optimista es "conflicto"; cualquier otro fallo (BD caída,
    // trigger de cronología roto) debe propagarse — reportarlo como conflicto haría
    // que el usuario reintente contra una base caída y ops nunca vea el error real.
    if ((e as { code?: string }).code === "P2025") return { ok: false, code: "conflicto" };
    throw e;
  }

  // Side-effects: jamás tumban la operación (lección 2026-07-24).
  const contactName = `${contact.firstName} ${contact.lastName}`.trim();
  const subject =
    assigneeId === null
      ? "Quitó la asignación de la conversación"
      : assigneeId === actor.id
        ? "Reclamó la conversación"
        : `Asignó la conversación a ${assignee?.name ?? assigneeId}`;
  try {
    await prisma.activity.create({
      data: {
        contactId: contact.id,
        userId: actor.id,
        activityType: "NOTE",
        subject,
        status: "COMPLETADA",
        completedAt: new Date(),
      },
    });
  } catch (e) {
    console.error("[inbox] no se pudo crear la actividad de asignación", e);
  }

  if (assignee && assignee.id !== actor.id) {
    try {
      await prisma.notification.create({
        data: {
          userId: assignee.id,
          type: ASSIGN_NOTIFICATION_TYPE,
          title: "Conversación asignada",
          message: `Te asignaron la conversación con ${contactName || "un contacto"}`,
          link: opts.conversationId ? `/inbox?focus=${opts.conversationId}` : "/inbox",
        },
      });
    } catch (e) {
      console.error("[inbox] no se pudo notificar al asignado", e);
    }
  }

  return { ok: true, assignedTo: assignee };
}
