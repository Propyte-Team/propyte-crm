// Resolución de cuenta WhatsApp: connector ↔ credenciales. config (consultable) +
// credentials (cifradas). Responsabilidad única, sin side-effects.
import prisma from "@/lib/db";
import type { LeadConnector } from "@prisma/client";
import { readCredentials } from "@/lib/intake/connectors";

export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
  verifyToken?: string;
  appSecret?: string;
  brand?: string;
}

type Secrets = { accessToken?: string; verifyToken?: string; appSecret?: string };

/** Combina config (phoneNumberId/brand) + secretos descifrados. `decrypt` inyectable para test. */
export function getWhatsAppCredentials(
  connector: LeadConnector,
  decrypt: (c: LeadConnector) => Secrets | null = (c) => readCredentials<Secrets>(c),
): WhatsAppCredentials | null {
  const config = (connector.config ?? {}) as { phoneNumberId?: string; brand?: string };
  const secrets = decrypt(connector) ?? {};
  if (!config.phoneNumberId || !secrets.accessToken) return null;
  return {
    phoneNumberId: config.phoneNumberId,
    accessToken: secrets.accessToken,
    verifyToken: secrets.verifyToken,
    appSecret: secrets.appSecret,
    brand: config.brand,
  };
}

/** Connector WhatsApp activo cuyo config.phoneNumberId == el recibido en el webhook. */
export async function resolveConnectorByPhoneNumberId(phoneNumberId: string): Promise<LeadConnector | null> {
  return prisma.leadConnector.findFirst({
    where: { provider: "WHATSAPP", status: "ACTIVE", deletedAt: null, config: { path: ["phoneNumberId"], equals: phoneNumberId } },
  });
}

/** Todos los connectors WhatsApp activos (para verify GET que no trae phone_number_id). */
export async function activeWhatsAppConnectors(): Promise<LeadConnector[]> {
  return prisma.leadConnector.findMany({ where: { provider: "WHATSAPP", status: "ACTIVE", deletedAt: null } });
}

/**
 * Credenciales de la línea por la que se debe RESPONDER a una conversación.
 *
 * `null` significa "usa el número global del env": es lo correcto cuando la
 * conversación no tiene connector (setup de una sola línea) o cuando el
 * connector guardado no es de WhatsApp.
 *
 * **Lanza** si el connector existe pero le faltan `phoneNumberId` o
 * `accessToken`. Es deliberado: con 2+ marcas activas, responderle al cliente
 * desde el número equivocado es peor que no responderle, porque el error es
 * invisible — llega un mensaje de otra empresa y nadie se entera. Una
 * excepción sí se ve.
 */
export async function resolveWhatsAppSender(
  connectorId?: string | null,
): Promise<WhatsAppCredentials | null> {
  if (!connectorId) return null;
  const connector = await prisma.leadConnector.findFirst({
    where: { id: connectorId, provider: "WHATSAPP", deletedAt: null },
  });
  if (!connector) return null;
  const credentials = getWhatsAppCredentials(connector);
  if (!credentials) {
    throw new Error(
      `El connector de WhatsApp "${connector.name}" (${connector.id}) no tiene phoneNumberId o accessToken. ` +
        `No se envía el mensaje para no responder desde otro número.`,
    );
  }
  return credentials;
}
