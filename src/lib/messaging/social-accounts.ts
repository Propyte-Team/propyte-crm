// Resolución de cuenta IG/Messenger: connector ↔ credenciales. config (consultable) +
// credentials (cifradas). Espejo de whatsapp/accounts.ts. Sin side-effects.
import prisma from "@/lib/db";
import type { LeadConnector } from "@prisma/client";
import { readCredentials } from "@/lib/intake/connectors";

type SocialSecrets = { pageAccessToken?: string };

/** Connector IG activo cuyo config.igBusinessId == el recibido en el webhook (objeto instagram). */
export async function resolveConnectorByIgBusinessId(igBusinessId: string): Promise<LeadConnector | null> {
  return prisma.leadConnector.findFirst({
    where: { provider: "INSTAGRAM", status: "ACTIVE", deletedAt: null, config: { path: ["igBusinessId"], equals: igBusinessId } },
  });
}

/** Connector Messenger activo cuyo config.pageId == el recibido en el webhook (objeto page). */
export async function resolveConnectorByPageId(pageId: string): Promise<LeadConnector | null> {
  return prisma.leadConnector.findFirst({
    where: { provider: "MESSENGER", status: "ACTIVE", deletedAt: null, config: { path: ["pageId"], equals: pageId } },
  });
}

/** Page Access Token descifrado del conector (para la Send API). `decrypt` inyectable para test. */
export function getSocialPageToken(
  connector: LeadConnector,
  decrypt: (c: LeadConnector) => SocialSecrets | null = (c) => readCredentials<SocialSecrets>(c),
): string | null {
  const token = decrypt(connector)?.pageAccessToken;
  return token && token.length ? token : null;
}
