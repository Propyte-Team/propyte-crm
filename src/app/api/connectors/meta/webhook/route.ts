// Webhook Meta Lead Ads (Anexo B §H.3) — intake en TIEMPO REAL para SLA <5min.
// GET: challenge de verificación · POST: leadgen → Graph API → captureLead.
// El reporting/conciliación Meta del Hub NO cambia; esto es solo intake.
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import prisma from "@/lib/db";
import {
  readCredentials,
  processIncomingLead,
  reservarLeadEntrante,
  marcarLeadFallido,
} from "@/lib/intake/connectors";
import { mapLead, parseRules, DEFAULT_META_RULES } from "@/lib/intake/map-lead";
import { buscarPorSecreto } from "@/lib/crypto/secretos";

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

  // #736: en tiempo constante y sin corte temprano. Riesgo menor que los otros —el
  // verify_token solo se usa al suscribir el webhook— pero cuesta lo mismo hacerlo bien.
  const conectores = await activeMetaConnectors();
  const connector = buscarPorSecreto<(typeof conectores)[number]>(
    conectores,
    token,
    (c: (typeof conectores)[number]) => readCredentials<MetaCredentials>(c)?.verifyToken
  );
  if (connector) return new NextResponse(challenge, { status: 200 });

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

  const results: Array<{ status: string; contactId?: string }> = [];
  // Fallos que no llegaron ni a producir un resultado (reserva o Graph).
  let fallos = 0;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const leadgenId = change.value?.leadgen_id;
      const pageId = change.value?.page_id;
      if (!leadgenId) continue;

      // Cuenta de ESA página. Con 2+ cuentas META (2+ marcas) un page_id sin cuenta NO se
      // asigna a otra: antes caía en la cuenta cuya firma validó y podía contarse como de
      // otra marca (2026-10-09, spec marcas-agente §4.2). Con una sola cuenta se conserva el
      // respaldo (instalación de una sola página). Sin `page_id` no se busca por página: si no,
      // `undefined === undefined` empataba con una cuenta de credenciales vacías (revisión final).
      const byPage = pageId
        ? connectors.find((c) => readCredentials<MetaCredentials>(c)?.pageId === pageId)
        : undefined;
      const target = byPage ?? (connectors.length === 1 ? matched.connector : null);
      if (!target) {
        console.warn("[meta-leadgen] page_id sin cuenta registrada; lead no asignado", { pageId, leadgenId });
        // Seguimiento T5 (2026-10-09): antes aquí solo quedaba el console.warn y el lead —ya
        // pagado— desaparecía sin ninguna fila en ConnectorLeadLog, contra el criterio de #713
        // (un lead pagado siempre deja rastro visible). Ahora se reserva bajo la cuenta cuya firma
        // validó (la única que sabemos legítima) y se deja en ERROR con el motivo: visible en
        // Conexiones y en el panel de leads fallidos. NO se pide a Graph (no hay token de esa
        // página) ni se asigna a ninguna marca; como la fila no guarda campos mapeados, el replay
        // automático la salta y se queda en ERROR hasta que alguien dé de alta la página.
        const detalle = `Página ${pageId ?? "(sin page_id)"} sin cuenta registrada en Conexiones; lead ${leadgenId} no asignado a ninguna marca`;
        try {
          const reserva = await reservarLeadEntrante(matched.connector.id, leadgenId, {
            webhook: change.value as Record<string, unknown>,
            motivo: "pagina_sin_cuenta",
          });
          // Ya terminado (PROCESSED/DUPLICATE): no hay nada que marcar.
          if (!reserva.yaProcesado) {
            // marcarLeadFallido deja el log en ERROR con el detalle y escribe lastError/errorCount
            // del conector (llama a markConnectorLead por dentro; llamarlo aparte contaría doble).
            await marcarLeadFallido(reserva.logId, matched.connector.id, detalle);
          }
        } catch (err) {
          // Igual que la reserva normal: sin rastro no hay 200 que valga, Meta debe reintentar.
          console.error(`[meta-webhook] no se pudo dejar rastro del lead ${leadgenId} (página sin cuenta):`, err);
          fallos++;
          continue;
        }
        results.push({ status: "pagina_sin_cuenta" });
        continue;
      }
      const creds = readCredentials<MetaCredentials>(target)!;

      const config = (target.config ?? {}) as { formIds?: string[] };
      if (config.formIds?.length && change.value?.form_id && !config.formIds.includes(change.value.form_id)) {
        continue; // formulario fuera del alcance del conector
      }

      // #713: se reserva el lugar del lead ANTES de pedirle nada a Graph. Si el token de
      // Página caducó —duran ~60 días y no se renuevan—, antes no quedaba ni una fila: el
      // lead, ya pagado, desaparecía sin dejar rastro. Ahora queda en ERROR, visible y
      // reprocesable.
      let logId: string | null = null;
      try {
        const reserva = await reservarLeadEntrante(target.id, leadgenId, {
          webhook: change.value as Record<string, unknown>,
        });
        if (reserva.yaProcesado) continue;
        logId = reserva.logId;
      } catch (err) {
        console.error(`[meta-webhook] no se pudo reservar el lead ${leadgenId}:`, err);
        fallos++;
        continue;
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

        const mapped = mapLead([...DEFAULT_META_RULES, ...parseRules(target.fieldMap)], { fieldData: external, metadata });
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
        fallos++;
        if (logId) await marcarLeadFallido(logId, target.id, String(err));
      }
    }
  }

  // #713: si algo falló, hay que DECÍRSELO a Meta. Un 200 con leads perdidos dentro es
  // una promesa falsa: Meta lo da por entregado y no reintenta nunca más. Con un 5xx
  // reintenta durante horas, y la marca de idempotencia impide que el reintento duplique
  // lo que sí entró en esta misma tanda.
  const conError = fallos + results.filter((r) => r.status === "ERROR").length;
  if (conError > 0) {
    return NextResponse.json(
      { ok: false, processed: results.length, failed: conError },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true, processed: results.length });
}
