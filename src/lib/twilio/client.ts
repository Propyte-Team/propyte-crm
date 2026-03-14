// Cliente Twilio singleton + validación de firma
import Twilio from "twilio";
import { headers } from "next/headers";

// Singleton del cliente Twilio
let _client: ReturnType<typeof Twilio> | null = null;

export function getTwilioClient() {
  if (!_client) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (!sid || !token) {
      throw new Error("Faltan credenciales de Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)");
    }

    _client = Twilio(sid, token);
  }
  return _client;
}

/**
 * Valida la firma de un webhook entrante de Twilio.
 * Usa el header X-Twilio-Signature para verificar autenticidad.
 */
export async function validateTwilioSignature(
  url: string,
  params: Record<string, string>
): Promise<boolean> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;

  const headersList = await headers();
  const signature = headersList.get("x-twilio-signature");
  if (!signature) return false;

  return Twilio.validateRequest(authToken, signature, url, params);
}
