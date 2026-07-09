// Endpoint autenticado para obtener token de voz Twilio
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { generateVoiceToken, isVoiceConfigured } from "@/lib/twilio/voice";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Twilio no configurado → degradar (200) en vez de 500; el VoiceProvider
  // trata token=null como "voz deshabilitada" sin ensuciar la consola.
  if (!isVoiceConfigured()) {
    return NextResponse.json({ token: null, configured: false });
  }

  try {
    const token = generateVoiceToken(session.user.id);
    return NextResponse.json({ token });
  } catch (error) {
    console.error("Error generando token de voz:", error);
    return NextResponse.json(
      { error: "Error al generar token" },
      { status: 500 }
    );
  }
}
