// Webhook entrante de Twilio para SMS
import { NextRequest, NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/twilio/client";
import { handleInboundSMS } from "@/lib/twilio/sms";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = value.toString();
  });

  // Validar firma de Twilio
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/sms`;
  const isValid = await validateTwilioSignature(url, params);

  if (!isValid) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 403 });
  }

  try {
    await handleInboundSMS({
      From: params.From,
      Body: params.Body,
      MessageSid: params.MessageSid,
      NumMedia: params.NumMedia,
      MediaUrl0: params.MediaUrl0,
    });

    // Twilio espera TwiML como respuesta
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { "Content-Type": "text/xml" } }
    );
  } catch (error) {
    console.error("Error procesando SMS entrante:", error);
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { "Content-Type": "text/xml" } }
    );
  }
}
