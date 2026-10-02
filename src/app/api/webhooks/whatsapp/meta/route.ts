// Webhook de WhatsApp Cloud API (Meta) — inbound de mensajes + estatus de entrega.
// Configurar en developers.facebook.com → tu app → WhatsApp → Configuration:
//   Callback URL: https://crm.propyte.com/api/webhooks/whatsapp/meta
//   Verify token: META_WA_VERIFY_TOKEN · Suscribir campo: messages
// Mismo flujo downstream que Twilio: handleInboundWhatsApp (inbox, bot, SLA, opt-out).
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import prisma from "@/lib/db";
import { handleInboundWhatsApp } from "@/lib/twilio/whatsapp";
import { resolveWaMediaToStorage } from "@/lib/whatsapp/media";
import { mediaTypeFromWaType } from "@/lib/messaging/media";
import { resolveConnectorByPhoneNumberId } from "@/lib/whatsapp/accounts";
import { secretosIgualesRecortados } from "@/lib/crypto/secretos";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Verificación de suscripción (hub.challenge)
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  // #736: en tiempo constante, ver src/lib/crypto/secretos.ts.
  const expected = process.env.META_WA_VERIFY_TOKEN;

  if (mode === "subscribe" && challenge && secretosIgualesRecortados(token, expected)) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "verify_token inválido" }, { status: 403 });
}

// Auditoría 2026-09-10: este webhook falla CERRADO, igual que el de DM desde #754.
//
// Antes, sin `META_WA_APP_SECRET` configurada, la función devolvía `true` — o sea que la
// ausencia de una variable de entorno abría el endpoint a cualquiera que conociera la URL,
// y la URL está escrita en el comentario de cabecera de este mismo archivo. Quien la
// encontrara podía inyectar mensajes entrantes falsos: dar de alta contactos, disparar al
// bot contra ellos, arrancar temporizadores de SLA y ensuciar el inbox.
//
// La #754 cerró exactamente este agujero en `webhooks/meta-dm` y dejó el razonamiento
// escrito ahí. Este endpoint —el de MAYOR volumen de los dos— se quedó fuera de aquel
// cambio; esto es la otra mitad.
//
// La dirección correcta del fallo es cerrar. Un webhook que rechaza todo se nota en horas
// —dejan de entrar mensajes y el inbox se congela, que es justo lo que la revisión diaria
// publica—; uno que acepta todo no se nota nunca. El aviso nombra la variable para que
// quien lea los registros sepa qué poner sin tener que averiguarlo.
//
// ⚠️ Al desplegar: confirma que META_WA_APP_SECRET está puesta en el entorno ANTES de
// subir esto. Si no lo está, el webhook pasa de aceptar todo a rechazar todo y deja de
// entrar cualquier mensaje de WhatsApp.
function validSignature(rawBody: string, signature: string | null): boolean {
  const appSecret = process.env.META_WA_APP_SECRET?.trim();
  if (!appSecret) {
    console.error(
      "[whatsapp-meta] META_WA_APP_SECRET no está configurada: se RECHAZA el webhook en vez " +
        "de aceptarlo sin verificar. Ponla en el entorno (ver .env.example) para volver a " +
        "recibir mensajes de WhatsApp.",
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

interface MetaMediaRef { id?: string; caption?: string; filename?: string; mime_type?: string }

interface MetaMessage {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
  image?: MetaMediaRef;
  audio?: MetaMediaRef;
  video?: MetaMediaRef;
  document?: MetaMediaRef;
  sticker?: MetaMediaRef;
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}

/** Referencia de media del mensaje según su tipo (null si es texto/interactivo). */
function mediaRefOf(msg: MetaMessage): MetaMediaRef | null {
  switch (msg.type) {
    case "image": return msg.image ?? null;
    case "audio": return msg.audio ?? null;
    case "video": return msg.video ?? null;
    case "document": return msg.document ?? null;
    case "sticker": return msg.sticker ?? null;
    default: return null;
  }
}

interface MetaStatus {
  id: string;
  status: string; // sent | delivered | read | failed
  /**
   * #829: BSUID del destinatario. Meta lo manda en sent/delivered/read (se omite en
   * failed) como identificador estable del destinatario — incluso cuando el mensaje
   * se mandó por teléfono, no solo cuando se usó el BSUID para direccionar el envío.
   *
   * Se usa ÚNICAMENTE para completar Contact.whatsappUserId cuando todavía no lo
   * teníamos (mismo criterio que `guardarBsuid` en el lado entrante, best-effort).
   * El emparejamiento del acuse con su Message sigue siendo por wamid (twilioSid =
   * st.id), que no depende de cómo se direccionó el envío — no hay un caso conocido
   * donde ese emparejamiento falle, así que a propósito NO se toca.
   */
  recipient_user_id?: string;
  recipient_id?: string;
  contacts?: MetaContact[];
}

/**
 * Entrada de `contacts[]`: una por remitente del batch.
 * - `user_id` (BSUID) → SIEMPRE presente desde abril de 2026, haya o no teléfono.
 * - `wa_id` (teléfono) → CONDICIONAL: solo si hubo interacción en los últimos 30 días
 *   o el usuario está en el contact book. Esa ventana se evalúa POR NÚMERO DE NEGOCIO.
 * - `username` → solo si el usuario lo adoptó. Todavía no se persiste.
 */
interface MetaContact {
  profile?: { name?: string };
  wa_id?: string;
  user_id?: string;
  username?: string;
}

/**
 * Entrada de `contacts[]` que corresponde a ESTE mensaje, o undefined si no se puede
 * saber con certeza.
 *
 * Se empareja contra el `from` del mensaje por teléfono (`wa_id`) o por el propio
 * BSUID (`user_id`), que es lo que viaja cuando Meta omite el teléfono. Con una sola
 * entrada se usa esa —el caso normal, y lo que este webhook ya asumía para el nombre
 * de perfil—.
 *
 * Con varias entradas y ninguna que case se devuelve undefined a propósito: de aquí
 * salen tanto el BSUID a guardar (#826) como el teléfono real con el que #827 resuelve
 * o da de alta el contacto — adivinar cualquiera de los dos dejaría el mensaje pegado
 * a la persona equivocada (BSUID en una columna UNIQUE ajena, o un contacto nuevo que
 * en realidad ya existía), y eso es peor y más difícil de deshacer que soltar el
 * mensaje y dejar que el BSUID real vuelva a llegar en el siguiente.
 */
function entradaDelRemitente(contacts: MetaContact[] | undefined, from: string): MetaContact | undefined {
  const lista = contacts ?? [];
  return lista.find((c) => c.wa_id === from || c.user_id === from) ?? (lista.length === 1 ? lista[0] : undefined);
}

/**
 * Guarda el BSUID en el contacto — best-effort y aditivo.
 *
 * `updateMany` con `whatsappUserId: null` en el WHERE, y no un `findUnique` seguido
 * de `update`: es UNA sentencia, así que dos mensajes del mismo remitente en el mismo
 * batch no se pisan, y nunca sobrescribe un BSUID ya guardado. Cuando ya está puesto
 * el UPDATE no afecta filas y se acabó.
 *
 * El `.catch` no es decorativo y la prueba lo fija: esto va DENTRO del bucle de
 * mensajes, y sin él un choque de UNIQUE (dos contactos reclamando el mismo BSUID,
 * p. ej. un duplicado previo del dedup) abortaría la ingesta del mensaje. Meta
 * reintentaría el batch entero y el inbox acabaría con el mensaje duplicado. El BSUID
 * es un dato de más: si no se puede guardar hoy, vuelve a llegar en el siguiente
 * mensaje. La ingesta no se negocia.
 */
async function guardarBsuid(contactId: string, bsuid: string | null) {
  if (!bsuid) return;
  await prisma.contact
    .updateMany({ where: { id: contactId, whatsappUserId: null }, data: { whatsappUserId: bsuid } })
    .catch((err) => console.error(`[whatsapp-meta] no se pudo guardar el BSUID de ${contactId}:`, err));
}

function extractBody(msg: MetaMessage): string {
  if (msg.text?.body) return msg.text.body;
  if (msg.button?.text) return msg.button.text;
  if (msg.interactive?.button_reply?.title) return msg.interactive.button_reply.title;
  if (msg.interactive?.list_reply?.title) return msg.interactive.list_reply.title;
  if (msg.image) return `[Imagen]${msg.image.caption ? ` ${msg.image.caption}` : ""}`;
  if (msg.audio) return "[Audio]";
  if (msg.video) return `[Video]${msg.video.caption ? ` ${msg.video.caption}` : ""}`;
  if (msg.sticker) return "[Sticker]";
  if (msg.document) return `[Documento${msg.document.filename ? `: ${msg.document.filename}` : ""}]`;
  return `[${msg.type}]`;
}

const STATUS_MAP: Record<string, "SENT" | "DELIVERED" | "READ" | "FAILED"> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sigHeader = req.headers.get("x-hub-signature-256");
  if (!validSignature(rawBody, sigHeader)) {
    // Se registra si la cabecera venía o no, nunca su valor: distingue «Meta no firmó»
    // de «la firma no cuadra», que son dos diagnósticos distintos.
    console.warn(`[whatsapp-meta] firma inválida → 401 (header ${sigHeader ? "presente" : "ausente"})`);
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let body: {
    entry?: Array<{
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string; display_phone_number?: string };
          contacts?: MetaContact[];
          messages?: MetaMessage[];
          statuses?: MetaStatus[];
        };
      }>;
    }>;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.warn("[whatsapp-meta] JSON inválido → 400");
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  // El otro gemelo de la #755, que allí se arregló sólo en meta-dm: `JSON.parse` acepta
  // `null`, `42` y `"texto"` sin lanzar, así que el catch de arriba no alcanza. El tipo de
  // `body` describe la forma esperada, no la valida. Sin esto un cuerpo de cuatro bytes
  // `null` pasaba el parse y reventaba en `body.entry` con un 500 no manejado, en vez del
  // 400 que corresponde.
  if (!body || typeof body !== "object") {
    console.warn("[whatsapp-meta] cuerpo JSON que no es un objeto → 400");
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  let processed = 0;
  // Coalescing del bot (BUG 2026-07-24): un batch de texto + N adjuntos disparaba N+1
  // respuestas (y N+1 llamadas a Claude secuenciales dentro de maxDuration=30 → riesgo
  // de timeout + retry de Meta). Se ingiere TODO el batch con triggerBot:false y el bot
  // responde UNA vez por contacto al final, ya con el contexto completo.
  const botTargets = new Map<string, { contactId: string; connectorId: string | null }>();
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Cuenta receptora (2026-07-25): metadata.phone_number_id identifica a QUÉ número
      // de WhatsApp llegó el mensaje → conector WHATSAPP (config.phoneNumberId) → el
      // Inbox muestra "WhatsApp · Marca" igual que IG/Messenger. Best-effort: sin
      // conector configurado todo fluye como antes (connectorId null).
      let connectorId: string | null = null;
      if (value.metadata?.phone_number_id) {
        try {
          connectorId = (await resolveConnectorByPhoneNumberId(value.metadata.phone_number_id))?.id ?? null;
        } catch (err) {
          console.error("[whatsapp-meta] resolución de conector falló:", err);
        }
      }

      // Estatus de entrega de mensajes salientes → actualizar Message.status
      for (const st of value.statuses ?? []) {
        const mapped = STATUS_MAP[st.status];
        if (!mapped) continue;
        await prisma.message.updateMany({
          where: { twilioSid: st.id },
          data: { status: mapped },
        }).catch(() => {});

        // #829: el acuse trae el BSUID del destinatario — se aprovecha para
        // completar Contact.whatsappUserId si todavía no lo teníamos (p. ej. le
        // mandamos por teléfono pero nunca nos había llegado un entrante suyo).
        // Best-effort y aditivo, igual que guardarBsuid: si no hay BSUID en este
        // acuse, o no se encuentra el Message, no pasa nada.
        const bsuid = st.recipient_user_id ?? st.contacts?.find((c) => c.user_id)?.user_id ?? null;
        if (bsuid) {
          const msg = await prisma.message
            .findFirst({ where: { twilioSid: st.id }, select: { contactId: true } })
            .catch(() => null);
          if (msg?.contactId) await guardarBsuid(msg.contactId, bsuid);
        }
      }

      // Mensajes entrantes → mismo pipeline que Twilio (inbox/SLA/opt-out); bot al final
      const profileName = value.contacts?.[0]?.profile?.name;
      for (const msg of value.messages ?? []) {
        try {
          // Media: resolver el media ID → bucket chat-media (best-effort; si falla queda solo el placeholder)
          const mediaType = mediaTypeFromWaType(msg.type);
          const mediaRef = mediaRefOf(msg);
          let stored: { path: string; mimeType: string | null } | null = null;
          if (mediaType && mediaRef?.id) {
            stored = await resolveWaMediaToStorage(mediaRef.id);
          }
          // #827: `wa_id` es el teléfono REAL de este remitente — solo se usa ese, nunca
          // `msg.from` a ciegas, porque fuera de la ventana de 30 días `msg.from` ES el
          // BSUID y tratarlo como teléfono es justo el bug que duplicaba contactos.
          // Sin `wa_id` se manda `From: null` y el BSUID viaja aparte en `WhatsAppUserId`
          // para que el core lo reconozca por ese identificador en vez de inventar uno.
          const entrada = entradaDelRemitente(value.contacts, msg.from);
          const bsuid = entrada?.user_id ?? null;
          const realPhone = entrada?.wa_id ?? null;
          const saved = await handleInboundWhatsApp({
            From: realPhone ? `whatsapp:+${realPhone}` : null,
            WhatsAppUserId: bsuid,
            Body: extractBody(msg),
            MessageSid: msg.id, // wamid → idempotencia por UNIQUE
            ProfileName: profileName,
            ...(connectorId ? { ConnectorId: connectorId } : {}),
            ...(stored && mediaType
              ? {
                  MediaUrl0: stored.path,
                  MediaType: mediaType,
                  MediaMimeType: stored.mimeType ?? mediaRef?.mime_type ?? null,
                  MediaFilename: mediaRef?.filename ?? null,
                }
              : {}),
          }, { triggerBot: false });
          if (saved?.contactId) {
            botTargets.set(`${saved.contactId}:${connectorId ?? ""}`, { contactId: saved.contactId, connectorId });
            await guardarBsuid(saved.contactId, bsuid);
          }
          processed++;
        } catch (err) {
          console.error("[whatsapp-meta] inbound:", err);
        }
      }
    }
  }

  // Una respuesta del bot por contacto del batch (los guards internos de botRespond
  // deciden si procede: status BOT, opt-out, canal habilitado, staleness).
  for (const t of botTargets.values()) {
    try {
      const { botRespond } = await import("@/lib/bot/bot-respond");
      await botRespond(t.contactId, { channel: "WHATSAPP", connectorId: t.connectorId });
    } catch (err) {
      console.error("[whatsapp-meta] botRespond:", err);
    }
  }

  // Meta exige 200 rápido; reintenta si no
  return NextResponse.json({ ok: true, processed });
}
