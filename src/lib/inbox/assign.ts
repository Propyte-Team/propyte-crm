// src/lib/inbox/assign.ts
// Asignación de conversaciones (spec 2026-08-06): el dueño vive en
// Contact.assignedToId — asignar en el inbox = asignar el contacto en todo el CRM.
// Permisos ADENTRO del módulo (la ruta solo mapea códigos a HTTP):
//   mando (INBOX_MANAGERS) → asigna / reasigna / quita a cualquier usuario válido
//   no-mando → solo claim: a sí mismo y solo si el contacto está libre
import prisma from "@/lib/db";
import { withChangeSource } from "@/lib/audit/change-context";
import { isInboxManager } from "./roles";

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
    // No-mando: solo claim a sí mismo sobre contacto libre.
    if (assigneeId !== actor.id) return { ok: false, code: "sin-permiso" };
    if (contact.assignedToId === actor.id) {
      // Ya era suyo: idempotente, sin escribir (cubre carreras del auto-claim).
      return { ok: true, assignedTo: { id: actor.id, name: "" } };
    }
    if (contact.assignedToId !== null) return { ok: false, code: "ya-asignado" };
  }

  // Validar al asignado: activo y sin email .local — los usuarios QA no reciben
  // leads ni a mano (espíritu del gate anti-test AUD-09 del routing).
  let assignee: { id: string; name: string } | null = null;
  if (assigneeId !== null) {
    const user = await prisma.user.findFirst({
      where: { id: assigneeId, isActive: true, deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    if (!user || user.email.endsWith(".local")) return { ok: false, code: "usuario-invalido" };
    assignee = { id: user.id, name: user.name };
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
  } catch {
    return { ok: false, code: "conflicto" };
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
  } catch { /* side-effect: silencioso */ }

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
    } catch { /* side-effect: silencioso */ }
  }

  return { ok: true, assignedTo: assignee };
}
