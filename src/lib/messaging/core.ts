import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import type { IncomingMessage, MessagingChannel } from "./types";
import type { SocialProfile } from "./profile";

const PLACEHOLDER_LASTNAME = "(por identificar)";

type ContactWithAssigned = NonNullable<Awaited<ReturnType<typeof findContactByChannel>>>;

/** Aplica nombre/avatar/username del perfil social al contacto (best-effort; null si falla). */
async function applySocialProfile(
  contact: ContactWithAssigned,
  profile: SocialProfile,
  opts: { names: boolean } = { names: true }
): Promise<ContactWithAssigned | null> {
  try {
    const { withChangeSource } = await import("@/lib/audit/change-context");
    const baseCustom =
      typeof contact.custom === "object" && contact.custom !== null && !Array.isArray(contact.custom)
        ? (contact.custom as Record<string, unknown>)
        : {};
    const data: Record<string, unknown> = {};
    if (opts.names) {
      data.firstName = profile.firstName;
      data.lastName = profile.lastName ?? PLACEHOLDER_LASTNAME;
    }
    const customUpdates: Record<string, unknown> = {};
    if (profile.avatarUrl) customUpdates.avatarUrl = profile.avatarUrl;
    if (profile.username) customUpdates.ig_username = profile.username;
    if (Object.keys(customUpdates).length > 0) data.custom = { ...baseCustom, ...customUpdates };
    if (Object.keys(data).length === 0) return contact;
    return await withChangeSource({ source: "social_profile" }, (tx) =>
      tx.contact.update({
        where: { id: contact.id },
        data,
        include: { assignedTo: { select: { id: true, name: true } } },
      })
    );
  } catch (err) {
    console.warn(`[messaging] applySocialProfile falló (${contact.id}):`, err);
    return null;
  }
}

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

/** Busca el contacto por el id propio del canal. Para WHATSAPP usa match flexible (exacto + últimos 10 dígitos). */
async function findContactByChannel(channel: MessagingChannel, senderId: string) {
  if (channel === "WHATSAPP") {
    return prisma.contact.findFirst({
      where: {
        OR: [{ phone: senderId }, { phone: { endsWith: senderId.slice(-10) } }],
        deletedAt: null,
        mergedIntoId: null,
      },
      include: { assignedTo: { select: { id: true, name: true } } },
    });
  }
  const where = channel === "INSTAGRAM" ? { instagramId: senderId } : { messengerPsid: senderId };
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

  // Identidad social: perfil Graph SOLO cuando el contacto es nuevo o sigue placeholder
  // (1 llamada por contacto, no por mensaje). Best-effort: null jamás bloquea el intake.
  let profile: SocialProfile | null = null;
  if (msg.channel !== "WHATSAPP" && (!contact || contact.lastName === PLACEHOLDER_LASTNAME)) {
    const { fetchProfileForMessage } = await import("./profile");
    profile = await fetchProfileForMessage(msg);
  }

  if (!contact) {
    const { captureLead } = await import("@/lib/intake/capture-lead");
    const idField =
      msg.channel === "INSTAGRAM" ? { instagramId: msg.senderId }
      : msg.channel === "MESSENGER" ? { messengerPsid: msg.senderId }
      : { phone: msg.senderId };
    const result = await captureLead({
      source: SOURCE[msg.channel],
      firstName: profile?.firstName ?? (msg.profileName?.trim() || (msg.channel === "INSTAGRAM" ? "Instagram" : msg.channel === "MESSENGER" ? "Messenger" : "WhatsApp")),
      lastName: profile?.lastName ?? PLACEHOLDER_LASTNAME,
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
    // include sin select de escalares → whatsappOptOut disponible en ambas ramas
    if (!contact) return null;
    // el nombre ya lo puso captureLead; solo falta custom (avatar/username) si vino
    if (profile && (profile.avatarUrl || profile.username)) {
      contact = (await applySocialProfile(contact, profile, { names: false })) ?? contact;
    }
  } else if (profile) {
    contact = (await applySocialProfile(contact, profile)) ?? contact;
  }

  // Atribución de anuncios vía referral (Caso 2): m.me ref / click-to-DM ads.
  // Solo si el referral trae algo identificable (adId o ref) — si no, no hay
  // nada útil que atribuir.
  if (msg.referral && (msg.referral.adId || msg.referral.ref)) {
    const existingAttribution = await prisma.adAttribution.findUnique({ where: { contactId: contact.id } });
    if (!existingAttribution) {
      await prisma.adAttribution
        .create({
          data: {
            contactId: contact.id,
            network: "META_DM",
            utmSource: msg.channel === "INSTAGRAM" ? "instagram_ctm" : "messenger_ctm",
            utmContent: msg.referral.adId ?? null,
            utmCampaign: msg.referral.ref ?? null,
            firstTouch: new Date(),
          },
        })
        .catch((err) => console.error("[messaging] adAttribution referral:", err));
    }
    const prevCustom = (contact.custom as Record<string, unknown> | null) ?? {};
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: { custom: { ...prevCustom, meta_referral: msg.referral } as Prisma.InputJsonValue },
      include: { assignedTo: { select: { id: true, name: true } } },
    });
  }

  const { ensureConversation } = await import("./conversations");
  const conv = await ensureConversation({ contactId: contact.id, channel: msg.channel, connectorId: msg.connectorId ?? null });
  const conversation = await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), lastInboundAt: new Date(), unreadCount: { increment: 1 } },
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

  if (msg.channel === "WHATSAPP") {
    const { emitEvent } = await import("@/lib/workflows/events");
    await emitEvent("whatsapp.replied", "conversation", conversation.id, {
      contactId: contact.id,
      body: msg.text.slice(0, 500),
    });
  }

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
  } else if (
    conversation.status === "BOT" &&
    conversation.botEnabled &&
    !(msg.channel === "WHATSAPP" && contact.whatsappOptOut)
  ) {
    try {
      const { botRespond } = await import("@/lib/bot/bot-respond");
      await botRespond(contact.id, { channel: msg.channel });
    } catch (err) {
      console.error(`[messaging] botRespond (${msg.channel}) falló:`, err);
    }
  }

  return message;
}
