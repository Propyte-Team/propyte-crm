// Resolución de la marca de una cuenta/conversación (2026-10-09, spec marcas-agente §3.1, §7).
//
// Regla de oro: SOLO una marca NO predeterminada activa el camino nuevo del agente.
// Sin cuenta, sin brandId o con la predeterminada → { kind: "default" } y todo sigue igual
// que antes. Si la cuenta SÍ tiene brandId pero la marca no se puede usar (borrada o error
// de lectura) → "unavailable": el agente NO contesta. Contestar como Propyte a un cliente
// de otra marca es justo el error que esta capa existe para evitar (mismo criterio que
// resolveWhatsAppSender en src/lib/whatsapp/accounts.ts).
import prisma from "@/lib/db";
import type { Brand } from "@prisma/client";

export type BrandResolution =
  | { kind: "default" }
  | { kind: "brand"; brand: Brand }
  | { kind: "unavailable"; brandId: string };

export function isBrandScoped(r: BrandResolution): r is { kind: "brand"; brand: Brand } {
  return r.kind === "brand";
}

/** P2021 = tabla inexistente, P2022 = columna inexistente: la migración aún no se aplicó. */
function isMissingSchema(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function resolveBrandForConnector(connectorId: string | null | undefined): Promise<BrandResolution> {
  if (!connectorId) return { kind: "default" };
  let brandId: string | null;
  try {
    const c = await prisma.leadConnector.findUnique({ where: { id: connectorId }, select: { brandId: true } });
    brandId = c?.brandId ?? null;
  } catch (err) {
    if (isMissingSchema(err)) return { kind: "default" };
    console.error("[brands] no se pudo leer la cuenta", connectorId, err);
    return { kind: "unavailable", brandId: "?" };
  }
  if (!brandId) return { kind: "default" };
  try {
    const brand = await prisma.brand.findFirst({ where: { id: brandId, deletedAt: null } });
    if (!brand) {
      console.error("[brands] la cuenta apunta a una marca borrada o inexistente", connectorId, brandId);
      return { kind: "unavailable", brandId };
    }
    return brand.isDefault ? { kind: "default" } : { kind: "brand", brand };
  } catch (err) {
    console.error("[brands] no se pudo leer la marca", brandId, err);
    return { kind: "unavailable", brandId };
  }
}

/** Marca de la conversación más reciente del contacto (para AI_DRAFT, que no tiene conversación propia). */
export async function resolveBrandForContact(
  contactId: string,
): Promise<{ resolution: BrandResolution; conversationId: string | null }> {
  const conv = await prisma.conversation.findFirst({
    where: { contactId },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true, connectorId: true },
  });
  if (!conv) return { resolution: { kind: "default" }, conversationId: null };
  return { resolution: await resolveBrandForConnector(conv.connectorId), conversationId: conv.id };
}

let _default: { id: string | null; at: number } | null = null;
const TTL_MS = 60_000;

export async function getDefaultBrandId(): Promise<string | null> {
  if (_default && Date.now() - _default.at < TTL_MS) return _default.id;
  try {
    const row = await prisma.brand.findFirst({ where: { isDefault: true, deletedAt: null }, select: { id: true } });
    _default = { id: row?.id ?? null, at: Date.now() };
    return _default.id;
  } catch {
    return null;
  }
}

export function __resetBrandCacheForTests(): void {
  _default = null;
}
