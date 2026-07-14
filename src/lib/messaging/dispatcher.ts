import prisma from "@/lib/db";
import { readCredentials } from "@/lib/intake/connectors";
import type { MessagingChannel } from "./types";
import type { MessageStatus } from "@prisma/client";
import { isMediaAllowed, mediaPlaceholderBody, graphAttachmentType, type ChatMedia } from "./media";

const OUT_ACTIVITY: Record<MessagingChannel, "WHATSAPP_OUT" | "INSTAGRAM_OUT" | "MESSENGER_OUT"> = {
  WHATSAPP: "WHATSAPP_OUT",
  INSTAGRAM: "INSTAGRAM_OUT",
  MESSENGER: "MESSENGER_OUT",
};

/** URL que Meta pueda descargar: firma paths del bucket; URLs externas pasan tal cual. */
async function resolveMediaUrl(media: ChatMedia): Promise<string> {
  const { isStoragePath, signChatMediaUrls } = await import("@/lib/storage/chat-media");
  if (!isStoragePath(media.path)) return media.path;
  const map = await signChatMediaUrls([media.path]);
  const url = map[media.path];
  if (!url) throw new Error("No se pudo firmar la URL del adjunto");
  return url;
}

/** Envío saliente unificado por canal. Devuelve el Message creado. */
export async function sendChannelMessage(
  channel: MessagingChannel,
  contactId: string,
  body: string,
  userId: string,
  opts: { bot?: boolean; connectorId?: string | null; media?: ChatMedia | null } = {}
) {
  const media = opts.media ?? null;
  if (media && !isMediaAllowed(channel, media.type)) {
    throw new Error(`El canal ${channel} no soporta adjuntos de tipo ${media.type}`);
  }

  if (channel === "WHATSAPP") {
    const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { phone: true } });
    if (!c?.phone) throw new Error("Contacto sin teléfono");
    const { sendWhatsAppMessage } = await import("@/lib/twilio/whatsapp");
    const message = media
      ? await sendWhatsAppMessage(c.phone, body, contactId, userId, opts.connectorId ?? null, {
          ...media,
          url: await resolveMediaUrl(media),
        })
      : await sendWhatsAppMessage(c.phone, body, contactId, userId, opts.connectorId ?? null);
    if (opts.bot) {
      return prisma.message.update({
        where: { id: message.id },
        data: { sender: "BOT", aiGenerated: true, aiAutonomy: "L2" },
      });
    }
    return message;
  }

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { instagramId: true, messengerPsid: true },
  });
  const recipientId = channel === "INSTAGRAM" ? contact?.instagramId : contact?.messengerPsid;
  if (!recipientId) throw new Error(`Contacto sin id ${channel}`);

  if (!opts.connectorId) throw new Error(`Falta connectorId para enviar ${channel} (conversación sin cuenta resuelta)`);
  const connector = await prisma.leadConnector.findUnique({ where: { id: opts.connectorId } });
  if (!connector || connector.status !== "ACTIVE") throw new Error(`Conector ${channel} inválido o inactivo`);
  const creds = readCredentials<{ pageAccessToken: string }>(connector);
  if (!creds?.pageAccessToken) throw new Error(`Conector ${channel} sin pageAccessToken`);

  const send = channel === "INSTAGRAM"
    ? (await import("./adapters/instagram")).sendInstagram
    : (await import("./adapters/messenger")).sendMessenger;

  let result;
  if (media) {
    // texto + adjunto = 2 llamadas Graph (attachment no lleva texto); 1 solo Message persistido
    if (body.trim()) await send(creds.pageAccessToken, recipientId, body);
    const { sendGraphAttachment } = await import("./graph");
    result = await sendGraphAttachment(creds.pageAccessToken, recipientId, {
      url: await resolveMediaUrl(media),
      type: graphAttachmentType(media.type),
    });
  } else {
    result = await send(creds.pageAccessToken, recipientId, body);
  }

  const { ensureConversation } = await import("./conversations");
  const conv0 = await ensureConversation({ contactId, channel, connectorId: connector.id });
  const conversation = await prisma.conversation.update({ where: { id: conv0.id }, data: { lastMessageAt: new Date() } });

  const persistedBody = body.trim() || (media ? mediaPlaceholderBody(media.type, media.filename) : body);
  const message = await prisma.message.create({
    data: {
      contactId,
      userId,
      channel,
      direction: "OUTBOUND",
      body: persistedBody,
      externalMessageId: result.externalMessageId,
      status: result.status as MessageStatus,
      conversationId: conversation.id,
      sender: opts.bot ? "BOT" : "ADVISOR",
      aiGenerated: opts.bot ?? false,
      aiAutonomy: opts.bot ? "L2" : null,
      ...(media
        ? { mediaUrl: media.path, mediaType: media.type, mediaFilename: media.filename ?? null, mediaMimeType: media.mimeType ?? null }
        : {}),
    },
  });

  await prisma.activity.create({
    data: {
      contactId,
      userId,
      activityType: OUT_ACTIVITY[channel],
      subject: `Mensaje ${channel} enviado`,
      description: persistedBody.length > 100 ? persistedBody.slice(0, 100) + "..." : persistedBody,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  const { meetSlaTimers } = await import("@/lib/workflows/sla");
  await meetSlaTimers(contactId);

  return message;
}
