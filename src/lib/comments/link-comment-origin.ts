// Puente entre el comentario y el contacto del CRM, en sus dos momentos:
//
//  a) persistOpenerForKnownContact — el DM salió y la persona YA era contacto.
//     Guardar el opener nosotros, como BOT, es lo que evita que el eco del
//     propio mensaje entre como ADVISOR y dispare el takeover que enmudece al
//     bot (ver handleEchoMessage en lib/messaging/core.ts).
//
//  b) linkCommentOrigin — la persona responde el DM y el intake acaba de crear
//     el contacto: se estampa el origen y se rellena el opener en el hilo.
import prisma from "@/lib/db";

type Platform = "INSTAGRAM" | "FACEBOOK";
type Channel = "INSTAGRAM" | "MESSENGER";

const CHANNEL: Record<Platform, Channel> = {
  INSTAGRAM: "INSTAGRAM",
  FACEBOOK: "MESSENGER",
};

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

async function findContactByRecipient(platform: Platform, recipientId: string) {
  const where =
    platform === "INSTAGRAM" ? { instagramId: recipientId } : { messengerPsid: recipientId };
  return prisma.contact.findFirst({
    where: { ...where, deletedAt: null, mergedIntoId: null },
    select: { id: true, assignedToId: true },
  });
}

/** Escribe el opener en el hilo del contacto, sin alterar el control del hilo. */
async function writeOpener(args: {
  contactId: string;
  assignedToId: string | null;
  channel: Channel;
  connectorId: string;
  text: string;
  externalMessageId: string;
  createdAt?: Date;
}) {
  const { ensureConversation } = await import("@/lib/messaging/conversations");
  const conversation = await ensureConversation({
    contactId: args.contactId,
    channel: args.channel,
    connectorId: args.connectorId,
  });

  try {
    await prisma.message.create({
      data: {
        contactId: args.contactId,
        userId: args.assignedToId,
        channel: args.channel,
        direction: "OUTBOUND",
        body: args.text,
        externalMessageId: args.externalMessageId,
        status: "SENT",
        conversationId: conversation.id,
        sender: "BOT",
        aiGenerated: false,
        ...(args.createdAt ? { createdAt: args.createdAt } : {}),
      },
    });
  } catch (err) {
    // El eco de Meta pudo haberlo guardado antes: mismo mid, índice único.
    if (isUniqueViolation(err)) return null;
    throw err;
  }

  // Solo lastMessageAt: tocar status o unreadCount rompería el control del hilo.
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });
  return conversation.id;
}

export async function persistOpenerForKnownContact(args: {
  platform: Platform;
  connectorId: string;
  recipientId: string;
  text: string;
  externalMessageId: string;
}): Promise<string | null> {
  const contact = await findContactByRecipient(args.platform, args.recipientId);
  if (!contact) return null;

  return writeOpener({
    contactId: contact.id,
    assignedToId: contact.assignedToId,
    channel: CHANNEL[args.platform],
    connectorId: args.connectorId,
    text: args.text,
    externalMessageId: args.externalMessageId,
  });
}

/**
 * Llamado desde el intake cuando llega un inbound de IG/Messenger: si ese
 * remitente venía de un comentario, se cierra el círculo.
 */
export async function linkCommentOrigin(
  contactId: string,
  channel: Channel,
  senderId: string
): Promise<string | null> {
  const log = await prisma.commentRuleLog.findFirst({
    where: { dmRecipientId: senderId, contactId: null },
    orderBy: { createdAt: "desc" },
  });
  if (!log) return null;

  // Candado atómico sin transacción: dos inbounds casi simultáneos del mismo
  // remitente (reintento del webhook de Meta, o dos mensajes seguidos) pueden
  // pasar los dos el findFirst de arriba antes de que cualquiera actualice. El
  // opener queda protegido por el índice único de externalMessageId, pero
  // activity.create no tenía ninguna protección: se creaban dos notas
  // idénticas "Origen: comentario…" en la cronología del contacto. El
  // updateMany condicionado a contactId: null solo puede "ganar" una vez.
  const claimed = await prisma.commentRuleLog.updateMany({
    where: { id: log.id, contactId: null },
    data: { contactId },
  });
  if (claimed.count !== 1) return null; // otro inbound concurrente ya lo reclamó

  // Los dos pasos de abajo son cosméticos frente al estampado: si fallan, el
  // vínculo ya quedó hecho y no se pierde la trazabilidad.
  if (log.dmStatus === "SENT" && log.dmText && log.dmExternalMessageId) {
    try {
      const contact = await prisma.contact.findFirst({
        where: { id: contactId },
        select: { id: true, assignedToId: true },
      });
      await writeOpener({
        contactId,
        assignedToId: contact?.assignedToId ?? null,
        channel,
        connectorId: log.connectorId,
        text: log.dmText,
        externalMessageId: log.dmExternalMessageId,
        createdAt: log.createdAt, // el opener precede a la respuesta en el hilo
      });
    } catch (err) {
      console.error("[comments] backfill del opener falló:", err);
    }
  }

  try {
    // Activity.userId es NOT NULL: sin asesor asignado se atribuye a un ADMIN.
    const contact = await prisma.contact.findFirst({
      where: { id: contactId },
      select: { assignedToId: true },
    });
    const userId =
      contact?.assignedToId ??
      (await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } }))
        ?.id;
    if (userId) {
      await prisma.activity.create({
        data: {
          contactId,
          userId,
          activityType: "NOTE",
          subject: `Origen: comentario en la publicación ${log.postId}`,
          description: `Comentó "${log.matchedPhrase}" y se le respondió en público + DM automático.`,
          status: "COMPLETADA",
          completedAt: new Date(),
        },
      });
    }
  } catch (err) {
    console.error("[comments] actividad de origen falló:", err);
  }

  return log.id;
}
