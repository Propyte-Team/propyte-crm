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
