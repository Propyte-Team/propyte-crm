// Tras el <Dial> de una entrante: si el asesor contestó, cuelga limpio;
// si no contestó (no-answer/busy/failed), envía a buzón grabado.
import { NextRequest, NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/twilio/client";

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
      `${appUrl}/api/webhooks/twilio/voice/dial-action`,
      params
    ))
  ) {
    return new NextResponse("Firma inválida", { status: 403 });
  }

  // Si la llamada al asesor fue contestada, no hacer nada más (la llamada ya terminó).
  if (
    params.DialCallStatus === "completed" ||
    params.DialCallStatus === "answered"
  ) {
    return xml("");
  }

  // No contestó → buzón grabado.
  const recordingCb = `${appUrl}/api/webhooks/twilio/voice/recording`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  return xml(
    `<Say language="es-MX">En este momento no podemos atenderte. Deja tu mensaje después del tono.</Say>` +
      `<Record maxLength="120" recordingStatusCallback="${recordingCb}" />`
  );
}
