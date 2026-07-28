// Webhook de WhatsApp Cloud API (Meta) — inbound de mensajes + estatus de entrega.
// Configurar en developers.facebook.com → tu app → WhatsApp → Configuration:
//   Callback URL: https://crm.propyte.com/api/webhooks/whatsapp/meta
//   Verify token: META_WA_VERIFY_TOKEN · Suscribir campo: messages
// Mismo flujo downstream que Twilio: handleInboundWhatsApp (inbox, bot, SLA, opt-out).
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import prisma from "@/lib/db";
import { handleInboundWhatsApp } from "@/lib/twilio/whatsapp";
import { resolveWaMediaToStorage } from "@/lib/whatsapp/media";
import { mediaTypeFromWaType } from "@/lib/messaging/media";
import { resolveConnectorByPhoneNumberId } from "@/lib/whatsapp/accounts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Verificación de suscripción (hub.challenge)
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  const expected = process.env.META_WA_VERIFY_TOKEN?.trim();

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "verify_token inválido" }, { status: 403 });
}

function validSignature(rawBody: string, signature: string | null): boolean {
  const appSecret = process.env.META_WA_APP_SECRET?.trim();
  if (!appSecret) return true; // sin secret configurado no se valida (configurarlo en prod)
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature.slice(7), "hex"));
  } catch {
    return false;
  }
}

interface MetaMediaRef { id?: string; caption?: string; filename?: string; mime_type?: string }

interface MetaMessage {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
  image?: MetaMediaRef;
  audio?: MetaMediaRef;
  video?: MetaMediaRef;
  document?: MetaMediaRef;
  sticker?: MetaMediaRef;
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}

/** Referencia de media del mensaje según su tipo (null si es texto/interactivo). */
function mediaRefOf(msg: MetaMessage): MetaMediaRef | null {
  switch (msg.type) {
    case "image": return msg.image ?? null;
    case "audio": return msg.audio ?? null;
    case "video": return msg.video ?? null;
    case "document": return msg.document ?? null;
    case "sticker": return msg.sticker ?? null;
    default: return null;
  }
}

interface MetaStatus {
  id: string;
  status: string; // sent | delivered | read | failed
}

function extractBody(msg: MetaMessage): string {
  if (msg.text?.body) return msg.text.body;
  if (msg.button?.text) return msg.button.text;
  if (msg.interactive?.button_reply?.title) return msg.interactive.button_reply.title;
  if (msg.interactive?.list_reply?.title) return msg.interactive.list_reply.title;
  if (msg.image) return `[Imagen]${msg.image.caption ? ` ${msg.image.caption}` : ""}`;
  if (msg.audio) return "[Audio]";
  if (msg.video) return `[Video]${msg.video.caption ? ` ${msg.video.caption}` : ""}`;
  if (msg.sticker) return "[Sticker]";
  if (msg.document) return `[Documento${msg.document.filename ? `: ${msg.document.filename}` : ""}]`;
  return `[${msg.type}]`;
}

const STATUS_MAP: Record<string, "SENT" | "DELIVERED" | "READ" | "FAILED"> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!validSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let body: {
    entry?: Array<{
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string; display_phone_number?: string };
          contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
          messages?: MetaMessage[];
          statuses?: MetaStatus[];
        };
      }>;
    }>;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  let processed = 0;
  // Coalescing del bot (BUG 2026-07-24): un batch de texto + N adjuntos disparaba N+1
  // respuestas (y N+1 llamadas a Claude secuenciales dentro de maxDuration=30 → riesgo
  // de timeout + retry de Meta). Se ingiere TODO el batch con triggerBot:false y el bot
  // responde UNA vez por contacto al final, ya con el contexto completo.
  const botTargets = new Map<string, { contactId: string; connectorId: string | null }>();
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Cuenta receptora (2026-07-25): metadata.phone_number_id identifica a QUÉ número
      // de WhatsApp llegó el mensaje → conector WHATSAPP (config.phoneNumberId) → el
      // Inbox muestra "WhatsApp · Marca" igual que IG/Messenger. Best-effort: sin
      // conector configurado todo fluye como antes (connectorId null).
      let connectorId: string | null = null;
      if (value.metadata?.phone_number_id) {
        try {
          connectorId = (await resolveConnectorByPhoneNumberId(value.metadata.phone_number_id))?.id ?? null;
        } catch (err) {
          console.error("[whatsapp-meta] resolución de conector falló:", err);
        }
      }

      // Estatus de entrega de mensajes salientes → actualizar Message.status
      for (const st of value.statuses ?? []) {
        const mapped = STATUS_MAP[st.status];
        if (!mapped) continue;
        await prisma.message.updateMany({
          where: { twilioSid: st.id },
          data: { status: mapped },
        }).catch(() => {});
      }

      // Mensajes entrantes → mismo pipeline que Twilio (inbox/SLA/opt-out); bot al final
      const profileName = value.contacts?.[0]?.profile?.name;
      for (const msg of value.messages ?? []) {
        try {
          // Media: resolver el media ID → bucket chat-media (best-effort; si falla queda solo el placeholder)
          const mediaType = mediaTypeFromWaType(msg.type);
          const mediaRef = mediaRefOf(msg);
          let stored: { path: string; mimeType: string | null } | null = null;
          if (mediaType && mediaRef?.id) {
            stored = await resolveWaMediaToStorage(mediaRef.id);
          }
          const saved = await handleInboundWhatsApp({
            From: `whatsapp:+${msg.from}`,
            Body: extractBody(msg),
            MessageSid: msg.id, // wamid → idempotencia por UNIQUE
            ProfileName: profileName,
            ...(connectorId ? { ConnectorId: connectorId } : {}),
            ...(stored && mediaType
              ? {
                  MediaUrl0: stored.path,
                  MediaType: mediaType,
                  MediaMimeType: stored.mimeType ?? mediaRef?.mime_type ?? null,
                  MediaFilename: mediaRef?.filename ?? null,
                }
              : {}),
          }, { triggerBot: false });
          if (saved?.contactId) {
            botTargets.set(`${saved.contactId}:${connectorId ?? ""}`, { contactId: saved.contactId, connectorId });
          }
          processed++;
        } catch (err) {
          console.error("[whatsapp-meta] inbound:", err);
        }
      }
    }
  }

  // Una respuesta del bot por contacto del batch (los guards internos de botRespond
  // deciden si procede: status BOT, opt-out, canal habilitado, staleness).
  for (const t of botTargets.values()) {
    try {
      const { botRespond } = await import("@/lib/bot/bot-respond");
      await botRespond(t.contactId, { channel: "WHATSAPP", connectorId: t.connectorId });
    } catch (err) {
      console.error("[whatsapp-meta] botRespond:", err);
    }
  }

  // Meta exige 200 rápido; reintenta si no
  return NextResponse.json({ ok: true, processed });
}
