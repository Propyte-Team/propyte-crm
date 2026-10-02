// Servicio de WhatsApp via Twilio — envío, templates y recepción
import { prisma } from "@/lib/db";
import { getTwilioClient } from "./client";
import { findContactByPhone, findContactByWhatsAppUserId, normalizePhone } from "./utils";

/**
 * Envía un mensaje de WhatsApp a un contacto.
 *
 * ## `opciones.autoriaBot` (#687)
 *
 * La fila del mensaje nace con su autoría puesta. Antes esta función siempre escribía
 * `sender: "ADVISOR"` y quien enviaba en nombre del bot tenía que CORREGIRLO después con un
 * segundo update — y en `lib/agents/tools.ts` ese update llevaba `.catch(() => {})`, así
 * que si fallaba, un WhatsApp escrito por un agente quedaba en el hilo indistinguible de
 * uno escrito por una persona. Sin aviso, y con la tool devolviendo `{ sent: true }`.
 *
 * Crear-y-corregir tiene una ventana en la que la fila está mal, y esa ventana no se cierra
 * reportando mejor el error: se cierra no abriéndola. El camino de Instagram y Messenger de
 * `lib/messaging/dispatcher.ts` ya lo hacía así —escribe la autoría dentro del `create`— así
 * que esto no inventa un patrón, lo lleva al canal que se había quedado atrás.
 */
export async function sendWhatsAppMessage(
  to: string,
  body: string,
  contactId: string,
  userId: string,
  connectorId?: string | null,
  media?: { path: string; url: string; type: import("@/lib/messaging/media").ChatMediaType; filename?: string | null; mimeType?: string | null },
  opciones?: { autoriaBot?: boolean }
) {
  // El campo va con nombre en el objeto y no como séptimo booleano posicional a propósito:
  // `sendWhatsAppMessage(tel, texto, id, uid, null, undefined, true)` no dice qué es ese
  // `true`, y esta es la función que decide si un cliente ve un mensaje como humano o no.
  const autoriaBot = opciones?.autoriaBot === true;

  // #829: sin teléfono real se envía por BSUID. `to` llega "" para estos contactos
  // (mismo sentinel que usa el alta sin teléfono de leads email-only en capture-lead.ts
  // — Contact.phone sigue NOT NULL). Con teléfono se usa SIEMPRE el teléfono, aunque
  // también haya BSUID guardado: es lo que mantiene viva la ventana de 30 días y lo
  // que hace que Meta lo siga incluyendo en los webhooks — nunca al revés.
  let normalized: string | null = null;
  let bsuid: string | null = null;
  if (to) {
    normalized = normalizePhone(to);
  } else {
    const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { whatsappUserId: true } });
    bsuid = contact?.whatsappUserId ?? null;
    if (!bsuid) {
      throw new Error(`Contacto ${contactId} no tiene teléfono ni BSUID de WhatsApp guardado — no se puede enviar.`);
    }
  }

  // WhatsApp no renderea markdown: **x** → *x*, # títulos → *negrita* (fix 2026-07-13).
  // Se convierte AQUÍ (antes de entregar Y de persistir) para que Message.body y
  // Activity guarden exactamente el texto que recibió el cliente. Cubre a todos los
  // emisores: dispatcher (bot L2), workflows SEND_WHATSAPP, agent tools y API manual.
  const { formatForWhatsApp } = await import("@/lib/whatsapp/format");
  const text = formatForWhatsApp(body);

  // Transporte intercambiable (Meta Cloud API default / Twilio alterno) — 2026-06-11
  const { deliverWhatsApp, mediaSupportsCaption } = await import("@/lib/whatsapp/transport");

  // Multicuenta: la respuesta sale por la MISMA línea por la que entró el mensaje.
  // Antes se ignoraba el connector y todo salía por el número global del env, así
  // que con 2+ marcas activas el cliente recibía la respuesta desde otro número.
  // `null` = sin connector → número global (correcto con una sola línea).
  const { resolveWhatsAppSender } = await import("@/lib/whatsapp/accounts");
  const sender = await resolveWhatsAppSender(connectorId);

  // audio/sticker no aceptan caption → el texto (si hay) viaja como mensaje aparte ANTES
  if (media && text && !mediaSupportsCaption(media.type)) {
    await deliverWhatsApp(normalized, text, undefined, sender, bsuid);
  }
  const delivery = media
    ? await deliverWhatsApp(normalized, text, { url: media.url, type: media.type, filename: media.filename }, sender, bsuid)
    : await deliverWhatsApp(normalized, text, undefined, sender, bsuid);

  // Hilo de conversación (Anexo B §I) — el saliente también vive en el hilo
  const { ensureConversation } = await import("@/lib/messaging/conversations");
  const conv0 = await ensureConversation({ contactId, channel: "WHATSAPP", connectorId: connectorId ?? null });
  const conversation = await prisma.conversation.update({ where: { id: conv0.id }, data: { lastMessageAt: new Date() } });

  const { mediaPlaceholderBody } = await import("@/lib/messaging/media");
  const persistedBody = text || (media ? mediaPlaceholderBody(media.type, media.filename) : text);
  const message = await prisma.message.create({
    data: {
      contactId,
      userId,
      channel: "WHATSAPP",
      direction: "OUTBOUND",
      body: persistedBody,
      twilioSid: delivery.externalId, // wamid (Meta) o SID (Twilio)
      status: delivery.status,
      // #829: sin teléfono real, guarda el BSUID — mismo criterio que #827 adoptó para
      // senderId/externalPhone en el inbound: puede no ser un teléfono, y eso es preferible
      // a guardar vacío o inventar uno.
      externalPhone: normalized ?? bsuid,
      conversationId: conversation.id,
      // #687: los tres campos de autoría nacen juntos y en la misma escritura. Mismo
      // criterio y mismos valores que el camino de Instagram/Messenger del dispatcher.
      sender: autoriaBot ? "BOT" : "ADVISOR",
      aiGenerated: autoriaBot,
      aiAutonomy: autoriaBot ? "L2" : null,
      ...(media
        ? { mediaUrl: media.path, mediaType: media.type, mediaFilename: media.filename ?? null, mediaMimeType: media.mimeType ?? null }
        : {}),
    },
  });

  await prisma.activity.create({
    data: {
      contactId,
      userId,
      activityType: "WHATSAPP_OUT",
      subject: `WhatsApp enviado`,
      description: persistedBody.length > 100 ? persistedBody.substring(0, 100) + "..." : persistedBody,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  // Toque saliente real → cumple SLA de primer contacto (P2)
  const { meetSlaTimers } = await import("@/lib/workflows/sla");
  await meetSlaTimers(contactId);

  return message;
}

/**
 * Envía un template de WhatsApp Business API.
 *
 * `connectorId` (#828): igual que en `sendWhatsAppMessage`, la línea por la que debe
 * salir con 2+ marcas activas. Antes de #828 esta función no lo recibía en absoluto
 * y SIEMPRE salía por el número global del env — con una sola línea es invisible,
 * pero en cuanto se prende una segunda, cualquier plantilla (el camino para
 * retomar a alguien fuera de la ventana de 24h) le llega al cliente desde el
 * número equivocado, mientras el envío normal (que sí resolvía `connectorId`)
 * salía bien. `resolveWhatsAppSender` ya lanza si el connector existe pero le
 * faltan credenciales — aquí no se decide nada nuevo, solo se deja de omitirlo.
 */
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  templateParams: string[],
  contactId: string,
  userId: string,
  connectorId?: string | null,
  language: string = "es_MX"
) {
  // #829: mismo criterio que sendWhatsAppMessage — sin teléfono real se envía por
  // BSUID (solo lo soporta Meta Cloud API; Twilio no tiene esta extensión).
  let normalized: string | null = null;
  let bsuid: string | null = null;
  if (to) {
    normalized = normalizePhone(to);
  } else {
    const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { whatsappUserId: true } });
    bsuid = contact?.whatsappUserId ?? null;
    if (!bsuid) {
      throw new Error(`Contacto ${contactId} no tiene teléfono ni BSUID de WhatsApp guardado — no se puede enviar.`);
    }
  }

  // Plantilla aprobada — necesaria fuera de la ventana de 24h (business-initiated)
  const { activeProvider, deliverMetaTemplate } = await import("@/lib/whatsapp/transport");
  const { resolveWhatsAppSender } = await import("@/lib/whatsapp/accounts");
  const sender = await resolveWhatsAppSender(connectorId);
  let externalId: string;
  if (activeProvider() === "meta_cloud") {
    const delivery = await deliverMetaTemplate(normalized, templateName, language, templateParams, sender, bsuid);
    externalId = delivery.externalId;
  } else {
    if (!normalized) {
      throw new Error("Plantilla de WhatsApp vía Twilio requiere teléfono — el envío por BSUID solo existe en Meta Cloud API.");
    }
    const client = getTwilioClient();
    const from = process.env.TWILIO_WHATSAPP_NUMBER;
    if (!from) throw new Error("TWILIO_WHATSAPP_NUMBER no configurado");
    const twilioMsg = await client.messages.create({
      from: `whatsapp:${from}`,
      to: `whatsapp:${normalized}`,
      body: templateParams.join(" | "), // Fallback si no se usa contentSid
    });
    externalId = twilioMsg.sid;
  }

  const message = await prisma.message.create({
    data: {
      contactId,
      userId,
      channel: "WHATSAPP",
      direction: "OUTBOUND",
      body: `[Template: ${templateName}] ${templateParams.join(", ")}`,
      twilioSid: externalId,
      templateName,
      status: "SENT",
      // #829: puede no ser un teléfono — mismo criterio que sendWhatsAppMessage.
      externalPhone: normalized ?? bsuid,
    },
  });

  await prisma.activity.create({
    data: {
      contactId,
      userId,
      activityType: "WHATSAPP_OUT",
      subject: `Template WhatsApp: ${templateName}`,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });

  // #731: el envío normal de este mismo archivo ya cerraba el SLA; el de plantilla no.
  // Una plantilla es el saliente con el que se retoma a alguien fuera de la ventana de
  // 24 h, así que es justo el caso donde el reloj debe pararse.
  const { meetSlaTimers } = await import("@/lib/workflows/sla");
  await meetSlaTimers(contactId);

  return message;
}

/**
 * Procesa un WhatsApp entrante desde el webhook de Twilio o de Meta Cloud API.
 * Delega el intake agnóstico en handleInboundMessage (core). Solo retiene
 * lo específico de WhatsApp: opt-out por keyword antes de continuar el flujo.
 *
 * `From: null` (#827): el webhook de Meta Cloud lo manda así cuando el remitente no
 * trae `wa_id` (fuera de la ventana de 30 días o sin contact-book) — no hay teléfono
 * real para este mensaje, solo el BSUID en `WhatsAppUserId`. Twilio SIEMPRE manda un
 * teléfono real, así que ese caller nunca pasa `From: null`.
 */
export async function handleInboundWhatsApp(payload: {
  From: string | null;
  /** BSUID del remitente (#826/#827) — presente en todo webhook de Meta, con o sin teléfono. */
  WhatsAppUserId?: string | null;
  Body: string;
  MessageSid: string;
  NumMedia?: string;
  MediaUrl0?: string;
  MediaType?: string | null;
  MediaMimeType?: string | null;
  MediaFilename?: string | null;
  ProfileName?: string;
  /** Conector WHATSAPP del número que RECIBIÓ el mensaje (metadata.phone_number_id). */
  ConnectorId?: string | null;
}, opts: { triggerBot?: boolean } = {}) {
  const rawPhone = payload.From ? payload.From.replace("whatsapp:", "") : null;
  const bsuid = payload.WhatsAppUserId ?? null;

  // Opt-out por keyword (§I.3 paso 7) — específico de WhatsApp.
  // Si aplica, marca el contacto y NO continúa el flujo normal. Sin teléfono real
  // (#827) se busca por BSUID; sin ninguno de los dos no hay a quién marcar.
  const optOutWords = ["BAJA", "STOP", "ALTO", "UNSUBSCRIBE"];
  if (optOutWords.includes(payload.Body.trim().toUpperCase())) {
    const contact = rawPhone
      ? await findContactByPhone(rawPhone)
      : bsuid
        ? await findContactByWhatsAppUserId(bsuid)
        : null;
    if (contact) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { whatsappOptOut: true },
      });
      const { emitEvent } = await import("@/lib/workflows/events");
      await emitEvent("contact.opted_out", "contact", contact.id, { channel: "WHATSAPP" });
    }
    return null;
  }

  // Delegar intake completo al core agnóstico (§I.3 pasos 2-6)
  const { handleInboundMessage } = await import("@/lib/messaging/core");
  return handleInboundMessage({
    channel: "WHATSAPP",
    // #827: sin teléfono real, senderId pasa a ser el propio BSUID (sin decorar) y
    // senderIdIsPhone:false le avisa al core que no lo trate como teléfono.
    senderId: rawPhone ? normalizePhone(rawPhone) : bsuid ?? "desconocido",
    senderIdIsPhone: rawPhone !== null,
    whatsappUserId: bsuid,
    externalMessageId: payload.MessageSid,
    text: payload.Body,
    mediaUrl: payload.MediaUrl0 || null,
    mediaType: payload.MediaType ?? null,
    mediaMimeType: payload.MediaMimeType ?? null,
    mediaFilename: payload.MediaFilename ?? null,
    profileName: payload.ProfileName ?? null,
    connectorId: payload.ConnectorId ?? null,
  }, opts);
}
