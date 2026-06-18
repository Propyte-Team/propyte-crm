// TwiML de ENTRADA: rutea la llamada entrante al Client del asesor asignado;
// si no hay asesor / no contesta → buzón grabado. Auto-log Activity(CALL_INBOUND).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateTwilioSignature } from "@/lib/twilio/client";
import { findContactByPhone } from "@/lib/twilio/utils";

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
  if (
    !(await validateTwilioSignature(
      `${appUrl}/api/webhooks/twilio/voice/incoming`,
      params
    ))
  ) {
    return new NextResponse("Firma inválida", { status: 403 });
  }

  const from = params.From ?? "";

  // Tipo reducido para evitar conflicto entre el tipo completo de Prisma y el
  // objeto parcial que construimos tras captureLead.
  let contact: { id: string; assignedToId: string | null } | null = null;

  const found = await findContactByPhone(from);
  if (found) {
    contact = { id: found.id, assignedToId: found.assignedToId };
  } else {
    const { captureLead } = await import("@/lib/intake/capture-lead");
    const r = await captureLead({
      source: "LLAMADA_ENTRANTE",
      firstName: "Llamada",
      lastName: "(entrante)",
      phone: from,
    });
    if (r.contactId) {
      contact = { id: r.contactId, assignedToId: r.assignedToId };
    }
  }

  if (contact && contact.assignedToId && params.CallSid) {
    await prisma.activity
      .create({
        data: {
          contactId: contact.id,
          userId: contact.assignedToId,
          activityType: "CALL_INBOUND",
          subject: "Llamada entrante",
          status: "PENDIENTE",
          callSid: params.CallSid,
        },
      })
      .catch((e: unknown) => {
        if ((e as { code?: string })?.code !== "P2002")
          console.error("[voice/incoming] activity.create:", e);
      });
  } else if (contact && !contact.assignedToId) {
    console.warn(
      `[voice/incoming] llamada entrante sin asesor asignado, contacto ${contact.id} — Activity no registrada`
    );
  }

  const recordingCb = escapeXml(
    `${appUrl}/api/webhooks/twilio/voice/recording`
  );
  const notice = `<Say language="es-MX">Esta llamada puede ser grabada con fines de calidad.</Say>`;
  const voicemail =
    `<Say language="es-MX">En este momento no podemos atenderte. Deja tu mensaje después del tono.</Say>` +
    `<Record maxLength="120" recordingStatusCallback="${recordingCb}" />`;

  if (contact?.assignedToId) {
    return xml(
      notice +
        `<Dial timeout="20" record="record-from-answer-dual" recordingStatusCallback="${recordingCb}" recordingStatusCallbackEvent="completed" action="${escapeXml(`${appUrl}/api/webhooks/twilio/voice/dial-action`)}">` +
        `<Client>${escapeXml(contact.assignedToId)}</Client></Dial>`
    );
  }

  return xml(notice + voicemail);
}
