// Servicio de llamadas VoIP via Twilio — click-to-call, status, token
import { prisma } from "@/lib/db";
import { getTwilioClient } from "./client";
import { normalizePhone } from "./utils";
import Twilio from "twilio";

const { AccessToken } = Twilio.jwt;
const { VoiceGrant } = AccessToken;

/**
 * Inicia una llamada saliente desde el browser (via TwiML App).
 * Crea la llamada en Twilio y registra la actividad.
 */
export async function initiateCall(
  to: string,
  userId: string,
  contactId: string
) {
  const client = getTwilioClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  const normalized = normalizePhone(to);

  // Crear la llamada via Twilio REST API
  const call = await client.calls.create({
    to: normalized,
    from: process.env.TWILIO_PHONE_NUMBER!,
    twiml: `<Response><Dial>${normalized}</Dial></Response>`,
    statusCallback: `${appUrl}/api/webhooks/twilio/voice/status`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
  });

  // Registrar actividad de llamada
  await prisma.activity.create({
    data: {
      contactId,
      userId,
      activityType: "CALL_OUTBOUND",
      subject: "Llamada saliente VoIP",
      description: `Llamada a ${normalized} — SID: ${call.sid}`,
      status: "PENDIENTE",
    },
  });

  return { callSid: call.sid, status: call.status };
}

/**
 * Procesa el status callback de una llamada de Twilio.
 * Actualiza la actividad con duración y resultado.
 */
export async function handleCallStatus(payload: {
  CallSid: string;
  CallStatus: string;
  CallDuration?: string;
  From: string;
  To: string;
}) {
  const { CallSid, CallStatus, CallDuration } = payload;

  // Buscar la actividad por el SID en la descripción
  const activity = await prisma.activity.findFirst({
    where: {
      description: { contains: CallSid },
      activityType: "CALL_OUTBOUND",
    },
  });

  if (!activity) return;

  // Solo actualizar en estados finales
  if (["completed", "no-answer", "busy", "failed"].includes(CallStatus)) {
    await prisma.activity.update({
      where: { id: activity.id },
      data: {
        status: "COMPLETADA",
        completedAt: new Date(),
        duration_minutes: CallDuration ? Math.ceil(parseInt(CallDuration) / 60) : null,
        outcome: CallStatus === "completed"
          ? `Llamada completada (${CallDuration}s)`
          : `Llamada ${CallStatus}`,
      },
    });
  }
}

/**
 * Genera un token de acceso Twilio para el SDK de voz del browser.
 * Requiere TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_TWIML_APP_SID.
 */
export function generateVoiceToken(userId: string): string {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const apiKey = process.env.TWILIO_ACCOUNT_SID!; // En producción usar API Key SID separado
  const apiSecret = process.env.TWILIO_AUTH_TOKEN!;
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID!;

  const token = new AccessToken(accountSid, apiKey, apiSecret, {
    identity: userId,
    ttl: 3600,
  });

  const grant = new VoiceGrant({
    outgoingApplicationSid: twimlAppSid,
    incomingAllow: true,
  });

  token.addGrant(grant);

  return token.toJwt();
}
