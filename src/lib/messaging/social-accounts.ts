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

/**
 * #767 — señal de vida cuando el webhook RECHAZA la firma, antes de saber a qué conector
 * iba dirigida la entrega. Sin esto, un 401 de `meta-dm/route.ts` no dejaba ni una fila en
 * ninguna tabla: se veía IDÉNTICO a un día sin prospectos (`errorCount: 0`, `lastLeadAt`
 * intacto), y `crm_pulso` no tenía con qué distinguir «no llegó nada» de «llegó y lo
 * rechazamos». Como `META_DM_APP_SECRET` es UNO para todo el webhook, una firma inválida
 * rechaza el 100% de las entregas de TODOS los conectores de IG/Messenger por igual — no
 * hay forma de saber a cuál iba dirigida una entrega que no pasó la firma, así que se marca
 * a los conectores activos de ambos proveedores, no a uno adivinado.
 *
 * Reusa `markConnectorLead` (best-effort, nunca lanza) para que quede en el mismo lugar que
 * ya lee `crm_pulso` (`fallos_seguidos` = `errorCount`) — sin tabla ni columna nueva. El
 * import es dinámico, igual que en `messaging/core.ts`, para no crear una dependencia
 * estática de `messaging` hacia `intake`.
 */
export async function markSocialConnectorsSignatureRejected(reason: string): Promise<void> {
  try {
    const connectors = await prisma.leadConnector.findMany({
      where: { provider: { in: ["INSTAGRAM", "MESSENGER"] }, status: "ACTIVE", deletedAt: null },
      select: { id: true },
    });
    if (connectors.length === 0) return;
    const { markConnectorLead } = await import("@/lib/intake/connectors");
    await Promise.all(connectors.map((c: { id: string }) => markConnectorLead(c.id, reason)));
  } catch (err) {
    // Best-effort: una falla al marcar el rechazo no debe impedir que el 401 se responda.
    console.error("[social-accounts] no se pudo marcar el rechazo de firma:", err);
  }
}

/** Page Access Token descifrado del conector (para la Send API). `decrypt` inyectable para test. */
export function getSocialPageToken(
  connector: LeadConnector,
  decrypt: (c: LeadConnector) => SocialSecrets | null = (c) => readCredentials<SocialSecrets>(c),
): string | null {
  const token = decrypt(connector)?.pageAccessToken;
  return token && token.length ? token : null;
}
