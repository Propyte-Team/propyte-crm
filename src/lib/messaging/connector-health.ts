// Diagnóstico de conectores sociales: confirma presencia de los 3 campos SIN exponer secretos.
import type { LeadConnector } from "@prisma/client";
import { readCredentials } from "@/lib/intake/connectors";

export interface ConnectorHealth { ok: boolean; missing: string[] }

export function checkSocialConnector(
  connector: LeadConnector,
  decrypt: (c: LeadConnector) => { pageAccessToken?: string } | null = (c) => readCredentials<{ pageAccessToken?: string }>(c),
): ConnectorHealth {
  const config = (connector.config ?? {}) as { pageId?: string; igBusinessId?: string };
  const creds = decrypt(connector) ?? {};
  const missing: string[] = [];
  if (!config.pageId) missing.push("config.pageId");
  if (connector.provider === "INSTAGRAM" && !config.igBusinessId) missing.push("config.igBusinessId");
  if (!creds.pageAccessToken) missing.push("credentials.pageAccessToken");
  return { ok: missing.length === 0, missing };
}
