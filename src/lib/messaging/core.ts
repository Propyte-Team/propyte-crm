import prisma from "@/lib/db";
import type { IncomingMessage, MessagingChannel } from "./types";

const IN_ACTIVITY: Record<MessagingChannel, "WHATSAPP_IN" | "INSTAGRAM_IN" | "MESSENGER_IN"> = {
  WHATSAPP: "WHATSAPP_IN",
  INSTAGRAM: "INSTAGRAM_IN",
  MESSENGER: "MESSENGER_IN",
};

const SOURCE: Record<MessagingChannel, "WHATSAPP" | "INSTAGRAM" | "MESSENGER"> = {
  WHATSAPP: "WHATSAPP",
  INSTAGRAM: "INSTAGRAM",
  MESSENGER: "MESSENGER",
};

/** Busca el contacto por el id propio del canal. */
async function findContactByChannel(channel: MessagingChannel, senderId: string) {
  const where =
    channel === "INSTAGRAM" ? { instagramId: senderId }
    : channel === "MESSENGER" ? { messengerPsid: senderId }
    : { phone: senderId };
  return prisma.contact.findFirst({
    where: { ...where, deletedAt: null, mergedIntoId: null },
    include: { assignedTo: { select: { id: true, name: true } } },
  });
}

/**
 * Intake agnóstico de canal: match/captura → conversación → mensaje (idempotente)
 * → actividad → SLA → bot/notify. Reutilizado por WhatsApp e IG/Messenger.
 */
export async function handleInboundMessage(msg: IncomingMessage) {
  let contact = await findContactByChannel(msg.channel, msg.senderId);

  if (!contact) {
    const { captureLead } = await import("@/lib/intake/capture-lead");
    const idField =
      msg.channel === "INSTAGRAM" ? { instagramId: msg.senderId }
      : msg.channel === "MESSENGER" ? { messengerPsid: msg.senderId }
      : { phone: msg.senderId };
    const result = await captureLead({
      source: SOURCE[msg.channel],
      firstName: msg.profileName?.trim() || (msg.channel === "INSTAGRAM" ? "Instagram" : msg.channel === "MESSENGER" ? "Messenger" : "WhatsApp"),
      lastName: "(por identificar)",
      message: msg.text,
      ...idField,
    });
    if (!result.contactId) {
      console.warn(`[messaging] inbound no capturable (${msg.channel}): ${msg.senderId}`);
      return null;
    }
    contact = await prisma.contact.findUnique({
      where: { id: result.contactId },
      include: { assignedTo: { select: { id: true, name: true } } },
    });
    if (!contact) return null;
  }

  const conversation = await prisma.conversation.upsert({
    where: { contactId_channel: { contactId: contact.id, channel: msg.channel } },
    update: { lastMessageAt: new Date(), lastInboundAt: new Date(), unreadCount: { increment: 1 } },
    create: {
      contactId: contact.id,
      channel: msg.channel,
      status: "BOT",
      lastMessageAt: new Date(),
      lastInboundAt: new Date(),
      unreadCount: 1,
    },
  });

  let message;
  try {
    message = await prisma.message.create({
      data: {
        contactId: contact.id,
        userId: contact.assignedToId,
        channel: msg.channel,
        direction: "INBOUND",
        body: msg.text,
        externalMessageId: msg.externalMessageId,
        mediaUrl: msg.mediaUrl ?? null,
        status: "DELIVERED",
        externalPhone: msg.channel === "WHATSAPP" ? msg.senderId : null,
        conversationId: conversation.id,
        sender: "CONTACT",
      },
    });
  } catch (err: unknown) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      return prisma.message.findUnique({ where: { externalMessageId: msg.externalMessageId } });
    }
    throw err;
  }

  await prisma.activity.create({
    data: {
      contactId: contact.id,
      userId: contact.assignedToId || contact.id,
      activityType: IN_ACTIVITY[msg.channel],
      subject: `Mensaje ${msg.channel} de ${contact.firstName} ${contact.lastName}`,
      description: msg.text.length > 100 ? msg.text.slice(0, 100) + "..." : msg.text,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  const { meetSlaTimers } = await import("@/lib/workflows/sla");
  await meetSlaTimers(contact.id);

  if (conversation.status === "HUMAN") {
    const notifyUserId = (conversation as { controlledById?: string | null }).controlledById ?? contact.assignedToId;
    if (notifyUserId) {
      await prisma.notification.create({
        data: {
          userId: notifyUserId,
          title: `${msg.channel} recibido (controlas el hilo)`,
          message: `${contact.firstName} ${contact.lastName}: ${msg.text.slice(0, 80)}`,
          type: "social_inbound",
          link: `/inbox?c=${conversation.id}`,
        },
      });
    }
  } else if (conversation.status === "BOT" && conversation.botEnabled) {
    try {
      const { botRespond } = await import("@/lib/bot/bot-respond");
      // NOTE: Task 12 actualizará la firma de botRespond para aceptar { channel }.
      // Por ahora casteamos para desbloquear compilación sin modificar botRespond.
      await (botRespond as (id: string, opts: { channel: MessagingChannel }) => Promise<unknown>)(contact.id, { channel: msg.channel });
    } catch (err) {
      console.error(`[messaging] botRespond (${msg.channel}) falló:`, err);
    }
  }

  return message;
}
