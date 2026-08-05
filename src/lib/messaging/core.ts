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
 * Echo (Caso 4): envío hecho por la Página desde OTRA superficie (Meta Business
 * Suite / app de la Página / el propio CRM), recibido con `message.is_echo`.
 * - Dedup contra envíos propios: el dispatcher persiste el `message_id` de la
 *   Send API en Message.externalMessageId (@unique) — si el mid del echo ya
 *   existe, es el eco de algo que el CRM mismo mandó → skip total.
 * - Sin contacto → skip (NUNCA crear contactos desde echoes; significa que la
 *   página escribió primero — caso raro).
 * - Registra OUTBOUND `sender: "ADVISOR"` (humano externo, no BOT) y aplica el
 *   takeover suave si la conversación estaba en BOT — mismo mecanismo que el
 *   envío manual del inbox (app/api/conversations/[id]/messages/route.ts).
 * - EXCEPCIÓN: si el mid del eco es el `dmExternalMessageId` de un
 *   `CommentRuleLog`, lo mandó el bot (una regla de comentarios), no un
 *   humano — se registra `sender: "BOT"` y NO se aplica el takeover. Ver la
 *   comprobación más abajo y su comentario: por qué existe.
 * - NO dispara side-effects de inbound (notificación, botRespond, actividad IN,
 *   lastInboundAt, unreadCount). SÍ marca los SLA timers como cumplidos, igual
 *   que el envío saliente del dispatcher (un humano respondió al lead).
 */
async function handleEchoMessage(msg: IncomingMessage) {
  const own = await prisma.message.findUnique({ where: { externalMessageId: msg.externalMessageId } });
  if (own) return own;

  const contact = await findContactByChannel(msg.channel, msg.senderId);
  if (!contact) {
    console.warn(`[messaging] echo sin contacto (${msg.channel}): ${msg.senderId} — la página escribió primero; skip`);
    return null;
  }

  const { ensureConversation } = await import("./conversations");
  const conv = await ensureConversation({ contactId: contact.id, channel: msg.channel, connectorId: msg.connectorId ?? null });
  const conversation = await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date() },
  });

  // Por qué existe esta comprobación: la defensa contra el eco del propio DM de
  // una regla de comentarios era escribir NOSOTROS el opener con el message_id de
  // la Send API (persistOpenerForKnownContact → writeOpener, en
  // lib/comments/link-comment-origin.ts), para que el eco de Meta chocara con
  // Message.externalMessageId @unique y se descartara. Eso es una CARRERA, no una
  // garantía: si el create() del eco de ABAJO commitea primero, ya se evaluó
  // conversation.status === "BOT" y ya se disparó el takeover; nuestro propio
  // create llega después, choca con P2002 y se descarta en silencio — demasiado
  // tarde, el bot ya se calló. Esta comprobación es determinista y no depende de
  // quién gane la carrera de commits: si el mid del eco es el de un DM que salió
  // por una regla, se sabe ANTES de decidir sender/takeover. try/catch: la tabla
  // puede no existir todavía (migración manual pendiente) o la consulta puede
  // fallar por cualquier otra razón — el eco debe seguir el camino de siempre,
  // nunca romper la ingesta.
  let fromCommentRule = false;
  try {
    const log = await prisma.commentRuleLog.findFirst({
      where: { dmExternalMessageId: msg.externalMessageId },
      select: { id: true },
    });
    fromCommentRule = !!log;
  } catch (err) {
    console.warn(`[messaging] chequeo de commentRuleLog en echo falló (sigue como eco normal):`, err);
  }

  let message;
  try {
    message = await prisma.message.create({
      data: {
        contactId: contact.id,
        userId: contact.assignedToId,
        channel: msg.channel,
        direction: "OUTBOUND",
        body: msg.text,
        externalMessageId: msg.externalMessageId,
        mediaUrl: msg.mediaUrl ?? null,
        status: "DELIVERED",
        conversationId: conversation.id,
        sender: fromCommentRule ? "BOT" : "ADVISOR",
        aiGenerated: false,
      },
    });
  } catch (err: unknown) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      return prisma.message.findUnique({ where: { externalMessageId: msg.externalMessageId } });
    }
    throw err;
  }

  // Takeover suave (réplica del envío manual del inbox): alguien del equipo ya
  // respondió desde otra superficie → el bot suelta el hilo y no habla encima.
  // Si el eco es el DM de una regla de comentarios, lo mandó el bot, no un
  // humano: la conversación se queda exactamente como está.
  if (!fromCommentRule && conversation.status === "BOT") {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "HUMAN", controlledById: contact.assignedToId ?? null, takeoverAt: new Date() },
    });
  }

  const { meetSlaTimers } = await import("@/lib/workflows/sla");
  await meetSlaTimers(contact.id);

  return message;
}

/**
 * Intake agnóstico de canal: match/captura → conversación → mensaje (idempotente)
 * → actividad → SLA → bot/notify. Reutilizado por WhatsApp e IG/Messenger.
 */
// opts.triggerBot=false: los webhooks con batch (whatsapp/meta, meta-dm) ingieren TODOS
// los mensajes primero y disparan el bot UNA vez por conversación al final (BUG 2026-07-24:
// texto + 2 adjuntos disparaban 3 respuestas). Default true = comportamiento de siempre
// para el resto de callers (Twilio manda 1 mensaje por webhook).
export async function handleInboundMessage(msg: IncomingMessage, opts: { triggerBot?: boolean } = {}) {
  if (msg.isEcho) return handleEchoMessage(msg);

  // Remitente marcado como spam: se descarta antes de crear nada. Un solo punto
  // cubre WhatsApp, Instagram y Messenger. Ver lib/moderation/block-sender.ts.
  const { isSenderBlocked } = await import("@/lib/moderation/is-blocked");
  if (await isSenderBlocked(msg.channel, msg.senderId)) {
    console.warn(`[messaging] inbound de remitente bloqueado (${msg.channel}): ${msg.senderId} — descartado`);
    return null;
  }

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

  // Media IG/Messenger: la URL del CDN de Meta expira → espejar al bucket (best-effort;
  // si falla se guarda la URL efímera, que renderiza mientras viva)
  let mediaUrl = msg.mediaUrl ?? null;
  let mediaMimeType = msg.mediaMimeType ?? null;
  if (mediaUrl && msg.mediaType) {
    try {
      const { isStoragePath, mirrorExternalMedia } = await import("@/lib/storage/chat-media");
      if (!isStoragePath(mediaUrl)) {
        const mirrored = await mirrorExternalMedia(mediaUrl);
        if (mirrored) {
          mediaUrl = mirrored.path;
          mediaMimeType = mediaMimeType ?? mirrored.mimeType;
        }
      }
    } catch (err) {
      console.warn(`[messaging] espejo de media falló (${msg.externalMessageId}):`, err);
    }
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
        mediaUrl,
        mediaType: msg.mediaType ?? null,
        mediaFilename: msg.mediaFilename ?? null,
        mediaMimeType,
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

  // ── Side-effects post-persistencia — NUNCA deben matar la ingesta ni enmudecer
  // al bot (BUG 2026-07-24: contacto SIN asignar → la actividad se creaba con
  // userId = contact.id → FK violada → moría TODO: sin actividad, SLA, eventos ni bot).
  try {
    // Activity.userId es NOT NULL (FK a users): sin asesor asignado se atribuye a un
    // ADMIN activo; si tampoco hay, se omite la actividad (el mensaje ya quedó en el hilo).
    const activityUserId =
      contact.assignedToId ??
      (await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } }))?.id;
    if (activityUserId) {
      await prisma.activity.create({
        data: {
          contactId: contact.id,
          userId: activityUserId,
          activityType: IN_ACTIVITY[msg.channel],
          subject: `Mensaje ${msg.channel} de ${contact.firstName} ${contact.lastName}`,
          description: msg.text.length > 100 ? msg.text.slice(0, 100) + "..." : msg.text,
          status: "COMPLETADA",
          completedAt: new Date(),
        },
      });
    }
  } catch (err) {
    console.error(`[messaging] activity inbound (${msg.channel}) falló:`, err);
  }

  // Origen por comentario: si este remitente recibió un DM disparado por una
  // regla de comentarios, se cierra el vínculo. Side-effect: jamás mata la ingesta.
  if (msg.channel !== "WHATSAPP") {
    try {
      const { linkCommentOrigin } = await import("@/lib/comments/link-comment-origin");
      await linkCommentOrigin(contact.id, msg.channel, msg.senderId);
    } catch (err) {
      console.error(`[messaging] linkCommentOrigin falló:`, err);
    }
  }

  try {
    const { meetSlaTimers } = await import("@/lib/workflows/sla");
    await meetSlaTimers(contact.id);
  } catch (err) {
    console.error(`[messaging] meetSlaTimers falló:`, err);
  }

  if (msg.channel === "WHATSAPP") {
    try {
      const { emitEvent } = await import("@/lib/workflows/events");
      await emitEvent("whatsapp.replied", "conversation", conversation.id, {
        contactId: contact.id,
        body: msg.text.slice(0, 500),
      });
    } catch (err) {
      console.error(`[messaging] emitEvent whatsapp.replied falló:`, err);
    }
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
    opts.triggerBot !== false &&
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
