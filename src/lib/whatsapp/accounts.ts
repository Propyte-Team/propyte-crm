// Resolución de cuenta WhatsApp: connector ↔ credenciales. config (consultable) +
// credentials (cifradas). Responsabilidad única, sin side-effects.
import prisma from "@/lib/db";
import type { LeadConnector } from "@prisma/client";
import { readCredentials } from "@/lib/intake/connectors";
import { resolveBrandForConnector } from "@/lib/brands/resolve";

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
 *
 * **También lanza** si el connector está BORRADO y es de una marca no
 * predeterminada (o su marca no se puede leer) — marcas del agente, 2026-10-09,
 * revisión final I2. Con `null` el hilo de esa marca saldría por el número
 * global, o sea con el WhatsApp de Propyte. Un connector borrado sin marca o de
 * la predeterminada sigue devolviendo `null`, como siempre.
 */
export async function resolveWhatsAppSender(
  connectorId?: string | null,
): Promise<WhatsAppCredentials | null> {
  if (!connectorId) return null;
  const connector = await prisma.leadConnector.findFirst({
    where: { id: connectorId, provider: "WHATSAPP", deletedAt: null },
  });
  if (!connector) {
    await throwIfDeletedBrandConnector(connectorId);
    return null;
  }
  const credentials = getWhatsAppCredentials(connector);
  if (!credentials) {
    throw new Error(
      `El connector de WhatsApp "${connector.name}" (${connector.id}) no tiene phoneNumberId o accessToken. ` +
        `No se envía el mensaje para no responder desde otro número.`,
    );
  }
  return credentials;
}

/**
 * Connector de WhatsApp borrado (soft delete) de una marca NO predeterminada → lanza. La marca la
 * decide el resolvedor de siempre (`resolveBrandForConnector` lee la cuenta aunque esté borrada):
 * sin marca o con la predeterminada → no hace nada; con otra marca o "no disponible" (marca
 * borrada, inexistente o ilegible) → lanza. Solo corre cuando el connector no se encontró activo.
 */
async function throwIfDeletedBrandConnector(connectorId: string): Promise<void> {
  const deleted = await prisma.leadConnector.findFirst({
    where: { id: connectorId, provider: "WHATSAPP", deletedAt: { not: null } },
    select: { id: true, name: true },
  });
  if (!deleted) return;
  const brand = await resolveBrandForConnector(connectorId);
  if (brand.kind === "default") return;
  throw new Error(
    `El connector de WhatsApp "${deleted.name}" (${deleted.id}) está eliminado y es de una marca no predeterminada. ` +
      `No se envía el mensaje desde el número global para no responder como otra marca.`,
  );
}
