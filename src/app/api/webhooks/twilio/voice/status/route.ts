// Webhook de status de llamadas de Twilio
import { NextRequest, NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/twilio/client";
import { handleCallStatus } from "@/lib/twilio/voice";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = value.toString();
  });

  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/voice/status`;
  const isValid = await validateTwilioSignature(url, params);

  if (!isValid) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 403 });
  }

  try {
    await handleCallStatus({
      CallSid: params.CallSid,
      CallStatus: params.CallStatus,
      CallDuration: params.CallDuration,
      From: params.From,
      To: params.To,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error procesando status de llamada:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
