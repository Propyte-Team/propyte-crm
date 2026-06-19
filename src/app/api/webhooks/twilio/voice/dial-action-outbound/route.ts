// action del <Dial> saliente: completa la Activity (duración/outcome/status) por callSid PADRE.
// Twilio invoca este endpoint cuando el <Dial> termina (DialCallStatus + DialCallDuration).
// El CallSid recibido aquí es el de la llamada PADRE (el mismo con el que se creó la Activity
// en twiml/route.ts), por lo que handleCallStatus lo encuentra y completa correctamente.
import { NextRequest, NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/twilio/client";
import { handleCallStatus } from "@/lib/twilio/voice";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = v.toString()));

  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/voice/dial-action-outbound`;
  if (!(await validateTwilioSignature(url, params))) {
    return new NextResponse("Firma inválida", { status: 403 });
  }

  if (params.CallSid && params.DialCallStatus) {
    await handleCallStatus({
      CallSid: params.CallSid,
      CallStatus: params.DialCallStatus,
      CallDuration: params.DialCallDuration,
      From: "",
      To: "",
    });
  }

  // Respuesta vacía: termina la llamada del cliente WebRTC.
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Response/>`,
    { headers: { "Content-Type": "text/xml" } }
  );
}
