// Webhook de WhatsApp Cloud API (Meta) — inbound de mensajes + estatus de entrega.
// Configurar en developers.facebook.com → tu app → WhatsApp → Configuration:
//   Callback URL: https://crm.propyte.com/api/webhooks/whatsapp/meta
//   Verify token: META_WA_VERIFY_TOKEN · Suscribir campo: messages
// Mismo flujo downstream que Twilio: handleInboundWhatsApp (inbox, bot, SLA, opt-out).
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import prisma from "@/lib/db";
import { handleInboundWhatsApp } from "@/lib/twilio/whatsapp";

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

interface MetaMessage {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  audio?: { id?: string };
  document?: { id?: string; filename?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
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
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Estatus de entrega de mensajes salientes → actualizar Message.status
      for (const st of value.statuses ?? []) {
        const mapped = STATUS_MAP[st.status];
        if (!mapped) continue;
        await prisma.message.updateMany({
          where: { twilioSid: st.id },
          data: { status: mapped },
        }).catch(() => {});
      }

      // Mensajes entrantes → mismo pipeline que Twilio (inbox/bot/SLA/opt-out)
      const profileName = value.contacts?.[0]?.profile?.name;
      for (const msg of value.messages ?? []) {
        try {
          await handleInboundWhatsApp({
            From: `whatsapp:+${msg.from}`,
            Body: extractBody(msg),
            MessageSid: msg.id, // wamid → idempotencia por UNIQUE
            ProfileName: profileName,
          });
          processed++;
        } catch (err) {
          console.error("[whatsapp-meta] inbound:", err);
        }
      }
    }
  }

  // Meta exige 200 rápido; reintenta si no
  return NextResponse.json({ ok: true, processed });
}
