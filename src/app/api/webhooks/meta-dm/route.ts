// Webhook de Instagram DM + Facebook Messenger (Meta Graph API).
// Configurar en developers.facebook.com → app → Webhooks:
//   Callback URL: https://crm.propyte.com/api/webhooks/meta-dm
//   Verify token: META_DM_VERIFY_TOKEN
//   Campos a suscribir: `messages` (DM) y `comments`/`feed` (comentarios) para
//   los objetos instagram y page. Meta permite UNA callback URL por objeto, así
//   que ambos tipos llegan aquí y se bifurcan por la forma del payload.
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { handleInboundMessage } from "@/lib/messaging/core";
import { parseInstagramWebhook } from "@/lib/messaging/adapters/instagram";
import { parseMessengerWebhook } from "@/lib/messaging/adapters/messenger";
import { resolveConnectorByIgBusinessId, resolveConnectorByPageId } from "@/lib/messaging/social-accounts";
import { parseCommentWebhook } from "@/lib/comments/parse";
import { secretosIgualesRecortados } from "@/lib/crypto/secretos";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  // #736: en tiempo constante, ver src/lib/crypto/secretos.ts.
  const expected = process.env.META_DM_VERIFY_TOKEN;
  if (mode === "subscribe" && challenge && secretosIgualesRecortados(token, expected)) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "verify_token inválido" }, { status: 403 });
}

// #714 (S-02): sin secreto configurado, esto devolvía `true` — o sea que la ausencia de una
// variable de entorno abría el webhook a cualquiera que conociera la URL, y la URL está en
// el comentario de arriba de este mismo archivo. En producción hoy la variable SÍ está
// puesta (medido: responde 401 sin firma), así que esto no cambia nada hoy: es la trampa
// para el próximo despliegue, un entorno de pruebas o una variable que alguien borre.
//
// La dirección correcta del fallo es cerrar. Un webhook que rechaza todo se nota en horas
// —dejan de entrar prospectos y `ultimo_lead` se congela, que es justo lo que la revisión
// diaria publica—; uno que acepta todo no se nota nunca. El aviso nombra la variable para
// que quien lea los registros sepa qué poner en vez de tener que averiguarlo.
function validSignature(rawBody: string, signature: string | null): boolean {
  const appSecret = process.env.META_DM_APP_SECRET?.trim();
  if (!appSecret) {
    console.error(
      "[meta-dm] META_DM_APP_SECRET no está configurada: se RECHAZA el webhook en vez de " +
        "aceptarlo sin verificar. Ponla en el entorno (ver .env.example) para volver a recibir DM.",
    );
    return false;
  }
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

  // #714 (S-02): ya no hay estado "skipped". La rama que existía —`!appSecret` →
  // "skipped" → no se rechaza— era la mitad de arriba del mismo agujero: aunque
  // `validSignature` cerrara, este `if` la esquivaba antes de llamarla. Se quitan las dos.
  if (!validSignature(rawBody, sigHeader)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let body: MetaWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const messages =
    body.object === "instagram"
      ? parseInstagramWebhook(body as Parameters<typeof parseInstagramWebhook>[0])
      : body.object === "page"
        ? parseMessengerWebhook(body as Parameters<typeof parseMessengerWebhook>[0])
        : [];

  // #714, arrastre de la #737: aquí vivía `results`, un arreglo que se llenaba en cuatro
  // sitios y NO LO LEÍA NADIE. Su único consumidor era el `recordHit` del buffer de
  // depuración que la #737 borró, y la respuesta JSON solo devuelve conteos. Se quita
  // ahora: una variable que se sigue llenando y nadie lee se lee como «esto se reporta a
  // alguien», y el próximo que venga a este archivo va a buscar a quién.
  //
  // No se pierde información: los dos caminos de error ya dejan su `console.error` con el
  // error real, que es lo único que había ahí que sirviera para diagnosticar.
  let processed = 0;
  // Coalescing del bot (BUG 2026-07-24): cada mensaje del batch disparaba una respuesta
  // completa. Se ingiere todo con triggerBot:false y el bot responde UNA vez por
  // contacto+canal al final. Los echoes jamás disparan al bot.
  const botTargets = new Map<string, { contactId: string; channel: typeof messages[number]["channel"]; connectorId: string | null }>();
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
      const saved = await handleInboundMessage(msg, { triggerBot: false });
      if (!msg.isEcho && saved?.contactId) {
        botTargets.set(`${saved.contactId}:${msg.channel}`, {
          contactId: saved.contactId,
          channel: msg.channel,
          connectorId: msg.connectorId ?? null,
        });
      }
      processed++;
    } catch (err) {
      console.error("[meta-dm] inbound:", err);
    }
  }

  // Una respuesta del bot por contacto+canal (guards internos de botRespond deciden).
  for (const t of botTargets.values()) {
    try {
      const { botRespond } = await import("@/lib/bot/bot-respond");
      await botRespond(t.contactId, { channel: t.channel, connectorId: t.connectorId });
    } catch (err) {
      console.error("[meta-dm] botRespond:", err);
    }
  }

  // Comentarios (entry[].changes): camino independiente del de DMs. Un fallo
  // aquí nunca debe afectar lo que ya se ingirió arriba.
  const parsed = parseCommentWebhook(body);

  // `parsed.discarded`: SÍ eran comentarios pero les faltó un campo
  // obligatorio (típicamente `from`, cuando Meta lo omite porque el
  // comentarista bloqueó la Página, falta pages_read_engagement, o la cuenta
  // fue borrada). parseCommentWebhook es pura y no loguea; este es el único
  // lugar donde se deja rastro de un comentario de cliente real que se cayó.
  for (const d of parsed.discarded) {
    console.warn(
      `[meta-dm] comentario descartado (${d.reason}) platform=${d.platform} account=${d.accountId} comment=${d.externalCommentId ?? "?"}`
    );
  }

  let commentsProcessed = 0;
  for (const c of parsed.comments) {
    try {
      const { handleComment } = await import("@/lib/comments/handle-comment");
      // El desenlace (`outcome.status`) se sigue registrando donde de verdad se consulta:
      // `handleComment` escribe su propia fila en el log de comentarios con el `logId` que
      // devuelve. No se añade un aviso aquí a cambio del `results` que se fue, porque de
      // los doce estados posibles la mayoría son desenlaces NORMALES —«propio», «anidado»,
      // «duplicado», «sin-match»— y avisar de todos convierte el registro en ruido.
      await handleComment(c);
      commentsProcessed++;
    } catch (err) {
      console.error("[meta-dm] comentario:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    comments: commentsProcessed,
    discarded: parsed.discarded.length,
  });
}
