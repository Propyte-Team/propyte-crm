// Caso 1: detección de duplicado al capturar teléfono/email por el bot.
// Regla de oro: NUNCA auto-merge — humano-en-loop obligatorio. Esta función
// solo notifica; la fusión sigue siendo una decisión manual en /duplicados.
import prisma from "@/lib/db";
import { normalizePhoneE164 } from "@/lib/phone";

export const DUPLICATE_NOTIFICATION_TYPE = "duplicate_detected";
const ANTI_SPAM_WINDOW_MS = 24 * 60 * 60 * 1000;

interface MatchLite {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
}

/**
 * Busca otros contactos activos con el mismo teléfono (E.164) o email que el
 * contacto dado y, si hay coincidencias, notifica al asesor asignado (o a los
 * ADMIN activos si no hay uno) con un link a /duplicados. Anti-spam: no repite
 * la misma notificación (mismo userId + link) dentro de una ventana de 24h.
 */
export async function detectDuplicatesForContact(contactId: string): Promise<void> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, deletedAt: null, mergedIntoId: null },
  });
  if (!contact) return;

  const phone = normalizePhoneE164(contact.phone);
  const email = contact.email?.trim().toLowerCase() || null;
  if (!phone && !email) return;

  const or: object[] = [];
  if (phone) or.push({ phone });
  if (email) or.push({ email });

  const matches = (await prisma.contact.findMany({
    where: {
      OR: or as never,
      id: { not: contactId },
      deletedAt: null,
      mergedIntoId: null,
    },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  })) as MatchLite[];
  if (matches.length === 0) return;

  let recipientIds: string[];
  if (contact.assignedToId) {
    recipientIds = [contact.assignedToId];
  } else {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
    });
    recipientIds = admins.map((a) => a.id);
  }
  if (recipientIds.length === 0) return;

  const link = `/duplicados?focus=${contactId}`;
  const matchedParts: string[] = [];
  if (phone) matchedParts.push(`teléfono ${phone}`);
  if (email) matchedParts.push(`email ${email}`);
  const matchNames = matches.map((m) => `${m.firstName} ${m.lastName}`).join(", ");
  const message = `${contact.firstName} ${contact.lastName} podría ser duplicado de ${matchNames} (coincide en ${matchedParts.join(" y ")})`;

  const since = new Date(Date.now() - ANTI_SPAM_WINDOW_MS);

  for (const userId of recipientIds) {
    const recent = await prisma.notification.findFirst({
      where: {
        userId,
        type: DUPLICATE_NOTIFICATION_TYPE,
        link,
        createdAt: { gte: since },
      },
    });
    if (recent) continue;

    await prisma.notification.create({
      data: {
        userId,
        title: "Posible contacto duplicado",
        message,
        type: DUPLICATE_NOTIFICATION_TYPE,
        link,
      },
    });
  }
}
