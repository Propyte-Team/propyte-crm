// Endpoint TwiML para conectar llamadas VoIP del browser
import { NextRequest, NextResponse } from "next/server";

// Solo permite dígitos, +, - y espacios (formato E.164 y variantes comunes)
const PHONE_REGEX = /^\+?[\d\s\-()]{8,20}$/;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const to = formData.get("To")?.toString() || "";

  if (!to || !PHONE_REGEX.test(to)) {
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="es-MX">Número de teléfono inválido.</Say>
</Response>`;
    return new NextResponse(errorTwiml, {
      headers: { "Content-Type": "text/xml" },
    });
  }

  const safeTo = escapeXml(to);
  const safeCallerId = escapeXml(process.env.TWILIO_PHONE_NUMBER || "");

  // Generar TwiML para conectar la llamada al número destino
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${safeCallerId}">
    <Number>${safeTo}</Number>
  </Dial>
</Response>`;

  return new NextResponse(twiml, {
    headers: { "Content-Type": "text/xml" },
  });
}
