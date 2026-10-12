// Webhook de Instagram DM + Facebook Messenger (Meta Graph API).
// Configurar en developers.facebook.com → app → Webhooks:
//   Callback URL: https://crm.propyte.com/api/webhooks/meta-dm
//   Verify token: META_DM_VERIFY_TOKEN
//   Campos a suscribir: `messages` (DM) y `comments`/`feed` (comentarios) para
//   los objetos instagram y page. Meta permite UNA callback URL por objeto, así
//   que ambos tipos llegan aquí y se bifurcan por la forma del payload.
//
// Acuse rápido (2026-10-12): Meta exige `200 OK` en menos de 20 s (requisito de App
// Review para Messenger); si tardamos más, reintenta, duplica eventos o marca el webhook.
// Antes el POST esperaba al bot (Claude + envío por Graph) por cada contacto y a cada
// comentario (respuesta pública + privada + lecturas de verificación, hasta ~22 s solo
// uno), así que un batch normal podía pasarse del límite.
//
// Ahora antes del 200 solo va lo que no se puede perder: firma, JSON y la INGESTA de cada
// DM (handleInboundMessage), para que el mensaje quede persistido antes de contestar. El
// bot y los comentarios se agendan con runAfterResponse (`after()` de Next) y corren
// cuando la respuesta ya salió.
//
// El costo, asumido a propósito: si el trabajo en segundo plano falla, Meta NO reintenta,
// porque ya le dijimos 200. Lo que importa no se pierde: los DMs quedan en la base antes
// del 200 (un bot que no contestó se ve en el inbox, con el hilo esperando respuesta) y
// cada comentario deja su rastro dentro de handleComment. Un fallo del bot o de un
// comentario sale en el console.error de su tarea.
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { handleInboundMessage } from "@/lib/messaging/core";
import { parseInstagramWebhook } from "@/lib/messaging/adapters/instagram";
import { parseMessengerWebhook } from "@/lib/messaging/adapters/messenger";
import {
  resolveConnectorByIgBusinessId,
  resolveConnectorByPageId,
  markSocialConnectorsSignatureRejected,
} from "@/lib/messaging/social-accounts";
import { parseCommentWebhook, type IncomingComment } from "@/lib/comments/parse";
import type { IncomingMessage } from "@/lib/messaging/types";
import { secretosIgualesRecortados } from "@/lib/crypto/secretos";
import { runAfterResponse } from "@/lib/runtime/after-response";

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

function validSignature(rawBody: string, signature: string | null): boolean {
  const appSecret = process.env.META_DM_APP_SECRET?.trim();
  if (!appSecret) {
    // Falla CERRADO (#754). Antes devolvía `true` con el comentario «sin secret no se
    // valida», lo que convertía este webhook en un endpoint de ESCRITURA sin
    // autenticar: cualquiera podía crear contactos y mensajes e inducir respuestas
    // del bot a PSIDs arbitrarios. Sin secret no hay forma de distinguir a Meta de
    // cualquier otro, así que la única respuesta correcta es rechazar.
    console.error("[meta-dm] META_DM_APP_SECRET no configurado → webhook rechazado (401)");
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

/** A quién le contesta el bot después del 200: uno por contacto+canal. */
interface BotTarget {
  contactId: string;
  channel: IncomingMessage["channel"];
  connectorId: string | null;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sigHeader = req.headers.get("x-hub-signature-256");
  // validSignature ya lee y valida META_DM_APP_SECRET. La segunda lectura de la env y
  // el estado "skipped" existían sólo para alimentar el buffer de diagnóstico que se
  // quitó en #737, y "skipped" nunca era `=== false`, así que este 401 no disparaba.
  if (!validSignature(rawBody, sigHeader)) {
    console.warn(`[meta-dm] firma inválida → 401 (header ${sigHeader ? "presente" : "ausente"})`);
    // #767: antes este 401 no dejaba rastro en ninguna tabla — se veía IDÉNTICO a un día
    // sin prospectos. Marca errorCount/lastError en los conectores activos de IG/Messenger
    // (best-effort, nunca lanza) para que `fallos_seguidos` en crm_pulso distinga
    // "no llegó nada" de "llegó y lo rechazamos".
    await markSocialConnectorsSignatureRejected(`firma inválida (401, header ${sigHeader ? "presente" : "ausente"})`);
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let body: MetaWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.warn("[meta-dm] JSON inválido → 400");
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  // JSON.parse acepta `null`, `42` y `"texto"` sin lanzar, así que el catch de arriba
  // no alcanza: el tipo MetaWebhookBody describe la forma esperada, no la valida. Sin
  // esto un cuerpo de cuatro bytes `null` pasaba y reventaba en `body.object` con un
  // 500 no manejado en vez del 400 que corresponde (#755).
  if (!body || typeof body !== "object") {
    console.warn("[meta-dm] cuerpo JSON que no es un objeto → 400");
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const messages =
    body.object === "instagram"
      ? parseInstagramWebhook(body as Parameters<typeof parseInstagramWebhook>[0])
      : body.object === "page"
        ? parseMessengerWebhook(body as Parameters<typeof parseMessengerWebhook>[0])
        : [];

  let processed = 0;
  // Coalescing del bot (BUG 2026-07-24): cada mensaje del batch disparaba una respuesta
  // completa. Se ingiere todo con triggerBot:false y el bot responde UNA vez por
  // contacto+canal al final. Los echoes jamás disparan al bot.
  const botTargets = new Map<string, BotTarget>();
  for (const msg of messages) {
    try {
      // Marcas del agente (2026-10-09, seguimiento T4): si el mensaje traía accountId pero ninguna
      // cuenta activa lo reclamó, el DM se ingiere igual (no se pierde) y NO dispara al bot.
      // Antes entraba a botTargets con connectorId null y botRespond lo trataba como la marca
      // predeterminada: con la cuenta de una marca en pausa, contestaba Propyte. WhatsApp ya tenía
      // este candado (`unknownNumber`). Sin accountId no hay cuenta a la cual atribuirlo y todo
      // sigue como antes.
      let cuentaSinConector = false;
      if (msg.accountId) {
        const connector = msg.channel === "INSTAGRAM"
          ? await resolveConnectorByIgBusinessId(msg.accountId)
          : await resolveConnectorByPageId(msg.accountId);
        // El perfil del remitente se resuelve en el core (profile.ts) solo para
        // inbound reales; los echoes (isEcho) nunca lo disparan — el emisor es la Página.
        if (connector) msg.connectorId = connector.id;
        else {
          cuentaSinConector = true;
          console.warn(`[meta-dm] sin conector activo para ${msg.channel} accountId=${msg.accountId}`);
        }
      }
      const saved = await handleInboundMessage(msg, { triggerBot: false });
      if (!msg.isEcho && saved?.contactId && !cuentaSinConector) {
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

  // Comentarios (entry[].changes): camino independiente del de DMs. Un fallo
  // aquí nunca debe afectar lo que ya se ingirió arriba.
  const parsed = parseCommentWebhook(body);

  // `parsed.discarded`: SÍ eran comentarios pero les faltó un campo
  // obligatorio (típicamente `from`, cuando Meta lo omite porque el
  // comentarista bloqueó la Página, falta pages_read_engagement, o la cuenta
  // fue borrada). parseCommentWebhook es pura y no loguea; este es el único
  // lugar donde se deja rastro de un comentario de cliente real que se cayó.
  // Va ANTES del 200: es un console.warn, no cuesta nada.
  for (const d of parsed.discarded) {
    console.warn(
      `[meta-dm] comentario descartado (${d.reason}) platform=${d.platform} account=${d.accountId} comment=${d.externalCommentId ?? "?"}`
    );
  }

  // Lo lento va después del 200 (ver cabecera). Solo se agenda si hay algo que hacer.
  const bots = [...botTargets.values()];
  const comments = parsed.comments;
  if (bots.length > 0 || comments.length > 0) {
    runAfterResponse(() => trabajoEnSegundoPlano(bots, comments));
  }

  // `comments` es lo ENCOLADO, no lo procesado: al responder todavía no corre ninguno.
  return NextResponse.json({
    ok: true,
    processed,
    comments: parsed.comments.length,
    discarded: parsed.discarded.length,
  });
}

/**
 * Lo que corre después de mandar el 200. Cada tarea lleva su try/catch: un bot o un
 * comentario que revienta no detiene a los demás. Secuencial, igual que cuando corría
 * dentro de la petición.
 */
async function trabajoEnSegundoPlano(bots: BotTarget[], comments: IncomingComment[]): Promise<void> {
  // Una respuesta del bot por contacto+canal (guards internos de botRespond deciden).
  for (const t of bots) {
    try {
      const { botRespond } = await import("@/lib/bot/bot-respond");
      await botRespond(t.contactId, { channel: t.channel, connectorId: t.connectorId });
    } catch (err) {
      console.error("[meta-dm] botRespond:", err);
    }
  }

  for (const c of comments) {
    try {
      const { handleComment } = await import("@/lib/comments/handle-comment");
      await handleComment(c);
    } catch (err) {
      console.error("[meta-dm] comentario:", err);
    }
  }
}
