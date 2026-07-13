// Webhook de Instagram DM + Facebook Messenger (Meta Graph API).
// Configurar en developers.facebook.com → app → Webhooks:
//   Callback URL: https://crm.propyte.com/api/webhooks/meta-dm
//   Verify token: META_DM_VERIFY_TOKEN · Suscribir field `messages` para objetos instagram y page.
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { handleInboundMessage } from "@/lib/messaging/core";
import { parseInstagramWebhook } from "@/lib/messaging/adapters/instagram";
import { parseMessengerWebhook } from "@/lib/messaging/adapters/messenger";
import { resolveConnectorByIgBusinessId, resolveConnectorByPageId } from "@/lib/messaging/social-accounts";
import { recordHit } from "@/lib/messaging/webhook-debug"; // [TEMPORAL] diagnóstico

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.META_DM_VERIFY_TOKEN?.trim();
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "verify_token inválido" }, { status: 403 });
}

function validSignature(rawBody: string, signature: string | null): boolean {
  const appSecret = process.env.META_DM_APP_SECRET?.trim();
  if (!appSecret) return true; // sin secret no se valida (configurarlo en prod)
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature.slice(7), "hex"));
  } catch {
    return false;
  }
}

interface MetaWebhookBody {
  object?: string;
  entry?: unknown[];
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sigHeader = req.headers.get("x-hub-signature-256");
  const appSecret = process.env.META_DM_APP_SECRET?.trim();
  const sigValid: boolean | "skipped" = !appSecret ? "skipped" : validSignature(rawBody, sigHeader);

  if (sigValid === false) {
    recordHit({
      at: new Date().toISOString(), sigHeader: !!sigHeader, sigValid,
      entryCount: 0, parsed: 0, processed: 0, results: [],
      note: "firma inválida → 401", rawSnippet: rawBody.slice(0, 500),
    });
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let body: MetaWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    recordHit({
      at: new Date().toISOString(), sigHeader: !!sigHeader, sigValid,
      entryCount: 0, parsed: 0, processed: 0, results: [],
      note: "JSON inválido → 400", rawSnippet: rawBody.slice(0, 500),
    });
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const messages =
    body.object === "instagram"
      ? parseInstagramWebhook(body as Parameters<typeof parseInstagramWebhook>[0])
      : body.object === "page"
        ? parseMessengerWebhook(body as Parameters<typeof parseMessengerWebhook>[0])
        : [];

  const results: Array<Record<string, unknown>> = [];
  let processed = 0;
  for (const msg of messages) {
    try {
      if (msg.accountId) {
        const connector = msg.channel === "INSTAGRAM"
          ? await resolveConnectorByIgBusinessId(msg.accountId)
          : await resolveConnectorByPageId(msg.accountId);
        // El perfil del remitente se resuelve en el core (profile.ts) solo para
        // inbound reales; los echoes (isEcho) nunca lo disparan — el emisor es la Página.
        if (connector) msg.connectorId = connector.id;
        else console.warn(`[meta-dm] sin conector activo para ${msg.channel} accountId=${msg.accountId}`);
      }
      await handleInboundMessage(msg);
      processed++;
      results.push({ channel: msg.channel, accountId: msg.accountId ?? null, connector: !!msg.connectorId, ok: true });
    } catch (err) {
      results.push({
        channel: msg.channel, accountId: msg.accountId ?? null, connector: !!msg.connectorId,
        ok: false, error: err instanceof Error ? err.message : String(err),
      });
      console.error("[meta-dm] inbound:", err);
    }
  }

  recordHit({
    at: new Date().toISOString(), object: body.object, sigHeader: !!sigHeader, sigValid,
    entryCount: Array.isArray(body.entry) ? body.entry.length : 0,
    parsed: messages.length, processed, results, rawSnippet: rawBody.slice(0, 500),
  });
  return NextResponse.json({ ok: true, processed });
}
