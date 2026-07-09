// Webhook Meta Lead Ads (Anexo B §H.3) — intake en TIEMPO REAL para SLA <5min.
// GET: challenge de verificación · POST: leadgen → Graph API → captureLead.
// El reporting/conciliación Meta del Hub NO cambia; esto es solo intake.
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import prisma from "@/lib/db";
import { readCredentials, processIncomingLead } from "@/lib/intake/connectors";
import { mapLead, parseRules } from "@/lib/intake/map-lead";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface MetaCredentials {
  pageId: string;
  pageAccessToken: string;
  appSecret: string;
  verifyToken: string;
}

async function activeMetaConnectors() {
  return prisma.leadConnector.findMany({
    where: { provider: "META", status: "ACTIVE", deletedAt: null },
  });
}

// Verificación de suscripción (hub.challenge)
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  for (const connector of await activeMetaConnectors()) {
    const creds = readCredentials<MetaCredentials>(connector);
    if (creds?.verifyToken && creds.verifyToken === token) {
      return new NextResponse(challenge, { status: 200 });
    }
  }
  return NextResponse.json({ error: "verify_token no coincide" }, { status: 403 });
}

function validSignature(rawBody: string, signature: string | null, appSecret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signature.slice("sha256=".length);
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

interface LeadgenChange {
  value?: { leadgen_id?: string; form_id?: string; page_id?: string };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const connectors = await activeMetaConnectors();

  // Validar firma contra el appSecret de algún conector activo
  let matched: { connector: (typeof connectors)[number]; creds: MetaCredentials } | null = null;
  for (const connector of connectors) {
    const creds = readCredentials<MetaCredentials>(connector);
    if (creds?.appSecret && validSignature(rawBody, signature, creds.appSecret)) {
      matched = { connector, creds };
      break;
    }
  }
  if (!matched) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  // Responder rápido es crítico (Meta reintenta >20s); el fetch del detalle es corto
  let body: { entry?: Array<{ changes?: LeadgenChange[] }> };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const results: unknown[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const leadgenId = change.value?.leadgen_id;
      const pageId = change.value?.page_id;
      if (!leadgenId) continue;

      // Conector específico de esa página (si hay varios)
      const target =
        connectors.find((c) => readCredentials<MetaCredentials>(c)?.pageId === pageId) ??
        matched.connector;
      const creds = readCredentials<MetaCredentials>(target)!;

      const config = (target.config ?? {}) as { formIds?: string[] };
      if (config.formIds?.length && change.value?.form_id && !config.formIds.includes(change.value.form_id)) {
        continue; // formulario fuera del alcance del conector
      }

      try {
        const detail = await fetch(
          `https://graph.facebook.com/v21.0/${leadgenId}?fields=field_data,created_time,ad_id,adset_id,campaign_id,ad_name,adset_name,campaign_name&access_token=${encodeURIComponent(creds.pageAccessToken)}`
        );
        if (!detail.ok) throw new Error(`Graph ${detail.status}: ${(await detail.text()).slice(0, 200)}`);
        const lead = (await detail.json()) as {
          field_data?: Array<{ name: string; values?: string[] }>;
          campaign_name?: string;
          campaign_id?: string;
          ad_name?: string;
          ad_id?: string;
          adset_name?: string;
          adset_id?: string;
        };

        const external: Record<string, unknown> = {};
        for (const f of lead.field_data ?? []) external[f.name] = f.values?.[0];
        if (change.value?.form_id) external.form_id = change.value.form_id; // form en custom (segmentación por form)

        // Metadata estructurada de la campaña/anuncio (fuente "metadata" del mapeo configurable)
        const metadata: Record<string, unknown> = {
          campaign_name: lead.campaign_name,
          campaign_id: lead.campaign_id,
          adset_name: lead.adset_name,
          adset_id: lead.adset_id,
          ad_name: lead.ad_name,
          ad_id: lead.ad_id,
          form_id: change.value?.form_id,
          leadgen_id: leadgenId,
        };

        const mapped = mapLead(parseRules(target.fieldMap), { fieldData: external, metadata });
        mapped.sourceDetail = [lead.campaign_name, lead.ad_name].filter(Boolean).join(" / ") || mapped.sourceDetail;
        mapped.fbclid = leadgenId;
        // Atribución estructurada → AdAttribution (segmentación por campaña/red en reglas/routing)
        mapped.campaignName = lead.campaign_name;
        mapped.adName = lead.ad_name;
        mapped.adsetName = lead.adset_name;
        mapped.network = target.provider === "INSTAGRAM" ? "INSTAGRAM" : "FACEBOOK";
        mapped.socialLeadId = leadgenId;

        results.push(await processIncomingLead(target.id, leadgenId, { external, meta: { ...lead, ...metadata } }, mapped));
      } catch (err) {
        console.error(`[meta-webhook] lead ${leadgenId}:`, err);
        await prisma.leadConnector.update({
          where: { id: target.id },
          data: { errorCount: { increment: 1 }, lastError: String(err).slice(0, 500) },
        }).catch(() => {});
      }
    }
  }

  return NextResponse.json({ ok: true, processed: results.length });
}
