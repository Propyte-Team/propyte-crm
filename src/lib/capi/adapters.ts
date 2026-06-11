// Adaptadores CAPI por plataforma (speckit #4 §5.1). Meta y TikTok reales
// (TikTok acepta el esquema de Meta vía Events API); Google/LinkedIn stubs
// estructurados (activarlos = completar el adapter + conector OUTBOUND).
import prisma from "@/lib/db";
import type { ConversionEvent, Contact } from "@prisma/client";
import { readCredentials } from "@/lib/intake/connectors";
import { buildHashedUserData } from "./hash";

export interface AdapterResult {
  ok: boolean;
  detail?: string;
  emq?: number;
}

const EVENT_NAMES_META: Record<string, string> = {
  LEAD: "Lead",
  QUALIFIED: "QualifiedLead",
  MEETING_SCHEDULED: "Schedule",
  RESERVED: "InitiateCheckout",
  WON: "Purchase",
};

async function outboundConnector(provider: string) {
  return prisma.leadConnector.findFirst({
    where: { provider: provider as never, direction: { in: ["OUTBOUND", "BOTH"] }, status: "ACTIVE", deletedAt: null },
  });
}

function basePayload(event: ConversionEvent, contact: Contact) {
  const clickIds = (event.clickIds ?? {}) as Record<string, string>;
  return {
    event_name: EVENT_NAMES_META[event.eventName] ?? event.eventName,
    event_time: Math.floor(event.occurredAt.getTime() / 1000),
    event_id: event.eventId,
    action_source: "system_generated",
    user_data: {
      ...buildHashedUserData({
        email: contact.email,
        phone: contact.phone,
        firstName: contact.firstName,
        lastName: contact.lastName,
        city: contact.residenceCity,
        country: contact.residenceCountry,
      }),
      ...(clickIds.fbclid ? { fbc: `fb.1.${event.occurredAt.getTime()}.${clickIds.fbclid}` } : {}),
    },
    custom_data: {
      lead_quality: event.leadQualityTier ?? undefined,
      ...(event.value ? { value: Number(event.value), currency: event.currency } : {}),
    },
  };
}

export async function sendToMeta(event: ConversionEvent, contact: Contact): Promise<AdapterResult> {
  const connector = await outboundConnector("META");
  if (!connector) return { ok: false, detail: "Sin conector META OUTBOUND activo" };
  const creds = readCredentials<{ pixelId?: string; capiAccessToken?: string; pageAccessToken?: string }>(connector);
  const pixelId = creds?.pixelId;
  const token = creds?.capiAccessToken ?? creds?.pageAccessToken;
  if (!pixelId || !token) return { ok: false, detail: "Conector META sin pixelId/capiAccessToken" };

  const res = await fetch(`https://graph.facebook.com/v21.0/${pixelId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [basePayload(event, contact)], access_token: token }),
  });
  const body = (await res.json().catch(() => ({}))) as { events_received?: number; error?: { message?: string } };
  if (!res.ok || body.error) {
    return { ok: false, detail: body.error?.message ?? `HTTP ${res.status}` };
  }
  return { ok: true, detail: `events_received=${body.events_received ?? 0}` };
}

export async function sendToTikTok(event: ConversionEvent, contact: Contact): Promise<AdapterResult> {
  const connector = await outboundConnector("TIKTOK");
  if (!connector) return { ok: false, detail: "Sin conector TIKTOK OUTBOUND activo" };
  const creds = readCredentials<{ pixelCode?: string; accessToken?: string }>(connector);
  if (!creds?.pixelCode || !creds.accessToken) {
    return { ok: false, detail: "Conector TIKTOK sin pixelCode/accessToken" };
  }

  const clickIds = (event.clickIds ?? {}) as Record<string, string>;
  const payload = basePayload(event, contact);
  const res = await fetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Access-Token": creds.accessToken },
    body: JSON.stringify({
      event_source: "crm",
      event_source_id: creds.pixelCode,
      data: [
        {
          event: payload.event_name,
          event_time: payload.event_time,
          event_id: payload.event_id,
          user: { ...payload.user_data, ttclid: clickIds.ttclid },
          properties: payload.custom_data,
        },
      ],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
  if (!res.ok || (body.code !== undefined && body.code !== 0)) {
    return { ok: false, detail: body.message ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

// Google offline conversions: requiere OAuth de Google Ads (no API key simple).
// Activación: completar con el flujo OAuth del conector GOOGLE (mismo patrón que google-ads-mcp).
export async function sendToGoogle(_event: ConversionEvent, _contact: Contact): Promise<AdapterResult> {
  return { ok: false, detail: "Adapter GOOGLE pendiente de activación (OAuth Google Ads)" };
}

// LinkedIn CAPI: diferido por decisión OQ5 (B2B menor prioridad).
export async function sendToLinkedIn(_event: ConversionEvent, _contact: Contact): Promise<AdapterResult> {
  return { ok: false, detail: "Adapter LINKEDIN diferido (OQ5)" };
}

export const ADAPTERS: Record<string, (e: ConversionEvent, c: Contact) => Promise<AdapterResult>> = {
  META: sendToMeta,
  TIKTOK: sendToTikTok,
  GOOGLE: sendToGoogle,
  LINKEDIN: sendToLinkedIn,
};
