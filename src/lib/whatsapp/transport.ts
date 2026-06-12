// Transporte de WhatsApp — provider intercambiable (decisión 2026-06-11: Propyte no
// tiene cuenta Twilio; se usa META Cloud API directo. Twilio queda como driver alterno).
//
// Selección: WHATSAPP_PROVIDER=meta_cloud|twilio. Default: meta_cloud si hay
// META_WA_PHONE_NUMBER_ID+META_WA_ACCESS_TOKEN; si no, twilio.
//
// Esta capa SOLO entrega el mensaje a la red; los side-effects (Conversation,
// Message, Activity, SLA) viven en lib/twilio/whatsapp.ts::sendWhatsAppMessage.

export interface DeliveryResult {
  externalId: string; // wamid (Meta) o SID (Twilio) — se guarda en Message.twilioSid
  status: "SENT" | "QUEUED";
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
async function deliverViaMetaCloud(toE164: string, body: string): Promise<DeliveryResult> {
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID?.trim();
  const token = process.env.META_WA_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !token) {
    throw new Error("META_WA_PHONE_NUMBER_ID / META_WA_ACCESS_TOKEN no configurados");
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toE164.replace("+", ""),
      type: "text",
      text: { preview_url: false, body },
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
  bodyParams: string[] = []
): Promise<DeliveryResult> {
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID?.trim();
  const token = process.env.META_WA_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !token) {
    throw new Error("META_WA_PHONE_NUMBER_ID / META_WA_ACCESS_TOKEN no configurados");
  }
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
async function deliverViaTwilio(toE164: string, body: string): Promise<DeliveryResult> {
  const { getTwilioClient } = await import("@/lib/twilio/client");
  const from = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!from) throw new Error("TWILIO_WHATSAPP_NUMBER no configurado");
  const client = getTwilioClient();
  const msg = await client.messages.create({
    body,
    from: `whatsapp:${from}`,
    to: `whatsapp:${toE164}`,
  });
  return { externalId: msg.sid, status: "SENT" };
}

export async function deliverWhatsApp(toE164: string, body: string): Promise<DeliveryResult> {
  return activeProvider() === "meta_cloud"
    ? deliverViaMetaCloud(toE164, body)
    : deliverViaTwilio(toE164, body);
}
