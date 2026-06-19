// TwiML de SALIDA (click-to-call WebRTC). Twilio invoca este endpoint cuando el
// browser hace device.connect({ To, contactId, userId }). Crea la Activity con el
// CallSid y devuelve TwiML con aviso de grabación + Dial grabado.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateTwilioSignature } from "@/lib/twilio/client";

const PHONE_REGEX = /^\+?[\d\s\-()]{8,20}$/;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xml(body: string) {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`,
    { headers: { "Content-Type": "text/xml" } }
  );
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = v.toString()));

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const valid = await validateTwilioSignature(
    `${appUrl}/api/webhooks/twilio/voice/twiml`,
    params
  );
  if (!valid) return new NextResponse("Firma inválida", { status: 403 });

  const to = params.To ?? "";
  if (!PHONE_REGEX.test(to)) {
    return xml(`<Say language="es-MX">Número de teléfono inválido.</Say>`);
  }

  // Determinar idioma del contacto para aviso de grabación
  let lang = "es-MX";
  let notice = "Esta llamada puede ser grabada con fines de calidad.";
  if (params.contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: params.contactId },
      select: { preferredLanguage: true, doNotContact: true },
    });
    if (contact?.doNotContact) {
      return xml(
        `<Say language="es-MX">Este contacto no autoriza llamadas.</Say><Hangup/>`
      );
    }
    if (contact?.preferredLanguage === "EN") {
      lang = "en-US";
      notice = "This call may be recorded for quality purposes.";
    }
  }

  // Registrar Activity CALL_OUTBOUND con el CallSid de Twilio
  if (params.CallSid && params.contactId && params.userId) {
    await prisma.activity
      .create({
        data: {
          contactId: params.contactId,
          userId: params.userId,
          activityType: "CALL_OUTBOUND",
          subject: "Llamada saliente",
          status: "PENDIENTE",
          callSid: params.CallSid,
        },
      })
      .catch((e: unknown) => {
        if ((e as { code?: string })?.code !== "P2002")
          console.error("[voice/twiml] activity.create:", e);
      });
  }

  const recordingCb = `${appUrl}/api/webhooks/twilio/voice/recording`;
  const actionCb = escapeXml(`${appUrl}/api/webhooks/twilio/voice/dial-action-outbound`);
  const safeTo = escapeXml(to);
  const callerId = escapeXml(process.env.TWILIO_PHONE_NUMBER ?? "");

  return xml(
    `<Say language="${lang}">${escapeXml(notice)}</Say>` +
      `<Dial callerId="${callerId}" record="record-from-answer-dual" recordingStatusCallback="${escapeXml(recordingCb)}" recordingStatusCallbackEvent="completed" action="${actionCb}">` +
      `<Number>${safeTo}</Number></Dial>`
  );
}
