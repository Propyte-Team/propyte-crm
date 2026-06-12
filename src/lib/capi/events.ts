// recordConversionEvent — registra el evento outbound (idempotente por eventId) y deja
// que el dispatcher del cron lo envíe a las plataformas (speckit #4 §5).
// Mapeo §5.2: Lead → Qualified (DISCOVERY_DONE o score≥umbral) → MeetingScheduled →
// Reserved (+value) → Won (+value).
import prisma from "@/lib/db";
import type { Contact, Deal } from "@prisma/client";
import type { ConversionEventName } from "@prisma/client";

const STAGE_EVENT: Record<string, ConversionEventName> = {
  DISCOVERY_DONE: "QUALIFIED",
  MEETING_SCHEDULED: "MEETING_SCHEDULED",
  RESERVED: "RESERVED",
  WON: "WON",
};

async function qualifiedScoreThreshold(): Promise<number> {
  const cfg = await prisma.systemConfig.findUnique({ where: { key: "capi.qualified_score_threshold" } });
  const n = Number(cfg?.value);
  return Number.isFinite(n) && n > 0 ? n : 70;
}

function tierFromScore(score: number): string {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}

// Plataformas destino = aquellas con click-id presente Y conector OUTBOUND activo
async function targetPlatforms(clickIds: Record<string, string>): Promise<string[]> {
  const outbound = await prisma.leadConnector.findMany({
    where: { direction: { in: ["OUTBOUND", "BOTH"] }, status: "ACTIVE", deletedAt: null },
    select: { provider: true },
  });
  const active = new Set(outbound.map((c) => c.provider as string));
  const platforms: string[] = [];
  if (clickIds.fbclid && active.has("META")) platforms.push("META");
  if (clickIds.gclid && active.has("GOOGLE")) platforms.push("GOOGLE");
  if (clickIds.ttclid && active.has("TIKTOK")) platforms.push("TIKTOK");
  if (clickIds.liFatId && active.has("LINKEDIN")) platforms.push("LINKEDIN");
  // Meta acepta eventos sin fbclid (matchea por PII hasheada) — si hay conector, siempre va
  if (!platforms.includes("META") && active.has("META")) platforms.push("META");
  return platforms;
}

export async function recordConversionEvent(
  eventName: ConversionEventName,
  contact: Contact,
  deal?: Deal | null
): Promise<boolean> {
  if (contact.doNotContact) return false; // PA7: sin consentimiento no sale nada

  const attribution = await prisma.adAttribution.findUnique({ where: { contactId: contact.id } });
  const clickIds: Record<string, string> = {};
  if (attribution?.fbclid) clickIds.fbclid = attribution.fbclid;
  if (attribution?.gclid) clickIds.gclid = attribution.gclid;
  if (attribution?.ttclid) clickIds.ttclid = attribution.ttclid;
  if (attribution?.liFatId) clickIds.liFatId = attribution.liFatId;

  const platforms = await targetPlatforms(clickIds);
  if (platforms.length === 0) return false; // sin conectores OUTBOUND activos → nada que mandar

  // eventId determinista = idempotencia interna + dedup vs pixel (§5.3)
  const scope = deal ? `deal:${deal.id}` : `contact:${contact.id}`;
  const eventId = `crm:${eventName.toLowerCase()}:${scope}`;

  try {
    await prisma.conversionEvent.create({
      data: {
        contactId: contact.id,
        dealId: deal?.id ?? null,
        eventName,
        eventId,
        value: eventName === "RESERVED" || eventName === "WON" ? deal?.estimatedValue ?? null : null,
        currency: deal?.currency ?? "MXN",
        leadQualityTier: tierFromScore(Number(contact.score)),
        clickIds,
        platforms,
      },
    });
    return true;
  } catch (err: unknown) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") return false; // ya registrado
    throw err;
  }
}

// Hook para cambios de etapa (lo llama transitionDealStage)
export async function recordStageConversion(deal: Deal, contact: Contact, toStage: string): Promise<void> {
  let eventName = STAGE_EVENT[toStage];
  if (!eventName) {
    // Qualified también por score alto aunque no llegue a DISCOVERY_DONE (OQ7)
    if (Number(contact.score) >= (await qualifiedScoreThreshold())) eventName = "QUALIFIED";
    else return;
  }
  await recordConversionEvent(eventName, contact, deal);
}
