// Transporte de WhatsApp — provider intercambiable (decisión 2026-06-11: Propyte no
// tiene cuenta Twilio; se usa META Cloud API directo. Twilio queda como driver alterno).
//
// Selección: WHATSAPP_PROVIDER=meta_cloud|twilio. Default: meta_cloud si hay
// META_WA_PHONE_NUMBER_ID+META_WA_ACCESS_TOKEN; si no, twilio.
//
// Esta capa SOLO entrega el mensaje a la red; los side-effects (Conversation,
// Message, Activity, SLA) viven en lib/twilio/whatsapp.ts::sendWhatsAppMessage.

import { formatForWhatsApp } from "./format";
import { waMessageType, type ChatMediaType } from "@/lib/messaging/media";

export interface DeliveryResult {
  externalId: string; // wamid (Meta) o SID (Twilio) — se guarda en Message.twilioSid
  status: "SENT" | "QUEUED";
}

/** Adjunto saliente: URL pública/firmada que Meta pueda descargar. */
export interface DeliveryMedia {
  url: string;
  type: ChatMediaType;
  filename?: string | null;
}

/** image/document/video aceptan caption; audio/sticker no (el texto va en mensaje aparte). */
export function mediaSupportsCaption(type: ChatMediaType): boolean {
  return type === "image" || type === "document" || type === "video" || type === "gif";
}

/**
 * Número emisor concreto, para setups con más de una línea de WhatsApp.
 *
 * Se tipa aquí (en vez de importar `WhatsAppCredentials` de `whatsapp/accounts`)
 * a propósito: accounts.ts arrastra Prisma, y este módulo tiene que poder
 * probarse mockeando solo `fetch`. Es estructuralmente compatible.
 *
 * Sin sender se cae al número global del env, que es el comportamiento correcto
 * cuando hay una sola línea.
 */
export interface WhatsAppSender {
  phoneNumberId: string;
  accessToken: string;
}

/** Credenciales efectivas: las del connector si vienen, si no las del env. */
function metaCredentials(sender?: WhatsAppSender | null): { phoneNumberId: string; token: string } {
  const phoneNumberId = sender?.phoneNumberId ?? process.env.META_WA_PHONE_NUMBER_ID?.trim();
  const token = sender?.accessToken ?? process.env.META_WA_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !token) {
    throw new Error("META_WA_PHONE_NUMBER_ID / META_WA_ACCESS_TOKEN no configurados");
  }
  return { phoneNumberId, token };
}

export type WhatsAppProvider = "meta_cloud" | "twilio";

export function activeProvider(): WhatsAppProvider {
  const explicit = process.env.WHATSAPP_PROVIDER?.trim().toLowerCase();
  if (explicit === "twilio") return "twilio";
  if (explicit === "meta_cloud") return "meta_cloud";
  if (process.env.META_WA_PHONE_NUMBER_ID?.trim() && process.env.META_WA_ACCESS_TOKEN?.trim()) {
    return "meta_cloud";
  }
  return "twilio";
}

// ---------------------------------------------------------------------------
// Driver META Cloud API (Graph) — texto libre dentro de la ventana de 24h.
// Fuera de ventana Meta responde 131047 → error claro (requiere plantilla).
// ---------------------------------------------------------------------------
async function deliverViaMetaCloud(
  toE164: string,
  body: string,
  media?: DeliveryMedia,
  sender?: WhatsAppSender | null
): Promise<DeliveryResult> {
  const { phoneNumberId, token } = metaCredentials(sender);

  let content: Record<string, unknown>;
  if (media) {
    const waType = waMessageType(media.type);
    const payload: Record<string, unknown> = { link: media.url };
    if (mediaSupportsCaption(media.type) && body) payload.caption = body;
    if (waType === "document" && media.filename) payload.filename = media.filename;
    content = { type: waType, [waType]: payload };
  } else {
    content = { type: "text", text: { preview_url: false, body } };
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toE164.replace("+", ""),
      ...content,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { code?: number; message?: string; error_data?: { details?: string } };
  };

  if (!res.ok || data.error) {
    const code = data.error?.code;
    const detail = data.error?.error_data?.details ?? data.error?.message ?? `HTTP ${res.status}`;
    if (code === 131047 || code === 131026) {
      throw new Error(
        `Fuera de la ventana de 24h de WhatsApp (${code}): se requiere plantilla aprobada. ${detail}`
      );
    }
    throw new Error(`Meta Cloud API ${code ?? res.status}: ${detail}`);
  }

  const wamid = data.messages?.[0]?.id;
  if (!wamid) throw new Error("Meta Cloud API: respuesta sin message id");
  return { externalId: wamid, status: "SENT" };
}

// Plantilla aprobada (para business-initiated fuera de ventana / cadencias)
export async function deliverMetaTemplate(
  toE164: string,
  templateName: string,
  language: string,
  bodyParams: string[] = [],
  sender?: WhatsAppSender | null
): Promise<DeliveryResult> {
  const { phoneNumberId, token } = metaCredentials(sender);
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toE164.replace("+", ""),
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        ...(bodyParams.length
          ? { components: [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) }] }
          : {}),
      },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { code?: number; message?: string };
  };
  if (!res.ok || data.error) {
    throw new Error(`Meta template ${data.error?.code ?? res.status}: ${data.error?.message ?? ""}`);
  }
  return { externalId: data.messages?.[0]?.id ?? "", status: "SENT" };
}

// ---------------------------------------------------------------------------
// Driver Twilio (alterno — requiere cuenta)
// ---------------------------------------------------------------------------
async function deliverViaTwilio(toE164: string, body: string, media?: DeliveryMedia): Promise<DeliveryResult> {
  const { getTwilioClient } = await import("@/lib/twilio/client");
  const from = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!from) throw new Error("TWILIO_WHATSAPP_NUMBER no configurado");
  const client = getTwilioClient();
  const msg = await client.messages.create({
    body,
    from: `whatsapp:${from}`,
    to: `whatsapp:${toE164}`,
    ...(media ? { mediaUrl: [media.url] } : {}),
  });
  return { externalId: msg.sid, status: "SENT" };
}

/**
 * @param sender Línea por la que debe salir el mensaje (multicuenta). Si se
 *   omite, sale por el número global del env — correcto con una sola línea.
 *   El driver Twilio lo ignora: ahí el número emisor vive en TWILIO_WHATSAPP_NUMBER.
 */
export async function deliverWhatsApp(
  toE164: string,
  body: string,
  media?: DeliveryMedia,
  sender?: WhatsAppSender | null
): Promise<DeliveryResult> {
  // Última línea de defensa: WhatsApp no renderea markdown (**x**, # títulos) —
  // se normaliza a formato nativo (*x*) para TODO emisor, con ambos drivers.
  // Idempotente: sendWhatsAppMessage ya la aplica antes de persistir el body.
  const text = formatForWhatsApp(body);
  return activeProvider() === "meta_cloud"
    ? deliverViaMetaCloud(toE164, text, media, sender)
    : deliverViaTwilio(toE164, text, media);
}
