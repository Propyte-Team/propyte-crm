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

  // ─────────────── Auditoría 2026-09-10: el número lo decide el SERVIDOR ───────────────
  //
  // Antes se marcaba `params.To` tal como venía, y sólo se comprobaba `doNotContact`
  // DENTRO de un `if (params.contactId)`. Los dos parámetros los pone el navegador en
  // `device.connect({ params })` (ver components/voice/voice-device-provider.tsx), así que:
  //
  //  1. Omitir `contactId` saltaba la comprobación de no-contactar POR COMPLETO. Un
  //     contacto que pidió no ser llamado se podía llamar igual, y encima sin dejar la
  //     Activity que lo registraría.
  //  2. Cualquier `To` que pasara el regex se marcaba — incluidos números de tarifa
  //     especial y de otros países, a cargo de la cuenta Twilio de la empresa. La firma de
  //     Twilio no ayuda aquí: Twilio firma lo que el navegador le mandó, así que valida el
  //     transporte, no la intención.
  //
  // Ahora `contactId` es OBLIGATORIO y el teléfono sale de la base. `params.To` se ignora.
  // No rompe nada: el único punto de entrada es components/voice/call-button.tsx, que
  // siempre manda `contactId`, y no hay marcador manual en la interfaz.
  if (!params.contactId) {
    console.warn("[voice/twiml] intento de marcar sin contactId → rechazado");
    return xml(`<Say language="es-MX">Llamada no autorizada.</Say><Hangup/>`);
  }

  const contact = await prisma.contact.findUnique({
    where: { id: params.contactId },
    select: { phone: true, preferredLanguage: true, doNotContact: true },
  });

  if (!contact) {
    return xml(`<Say language="es-MX">Contacto no encontrado.</Say><Hangup/>`);
  }

  // Ya no está dentro de un `if`: se comprueba SIEMPRE.
  if (contact.doNotContact) {
    console.warn(`[voice/twiml] contacto ${params.contactId} con doNotContact → no se marca`);
    return xml(`<Say language="es-MX">Este contacto no autoriza llamadas.</Say><Hangup/>`);
  }

  const to = contact.phone ?? "";
  if (!PHONE_REGEX.test(to)) {
    return xml(`<Say language="es-MX">Número de teléfono inválido.</Say>`);
  }

  // Idioma del contacto para el aviso de grabación
  let lang = "es-MX";
  let notice = "Esta llamada puede ser grabada con fines de calidad.";
  if (contact.preferredLanguage === "EN") {
    lang = "en-US";
    notice = "This call may be recorded for quality purposes.";
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
