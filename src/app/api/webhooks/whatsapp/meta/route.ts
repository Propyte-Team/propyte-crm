// Webhook de WhatsApp Cloud API (Meta) — inbound de mensajes + estatus de entrega.
// Configurar en developers.facebook.com → tu app → WhatsApp → Configuration:
//   Callback URL: https://crm.propyte.com/api/webhooks/whatsapp/meta
//   Verify token: META_WA_VERIFY_TOKEN · Suscribir campos: messages y, para la coexistencia
//   (2026-10-14), history, smb_app_state_sync, smb_message_echoes y account_update.
// Coexistencia: cada `change` se despacha por `change.field` (sin `field` = messages, el formato
// de siempre). Ecos y estado de la cuenta se aplican antes del 200; historial y libreta, después
// (un webhook de historial puede traer miles de mensajes). Ver lib/whatsapp/coex/webhook.ts.
// Mismo flujo downstream que Twilio: handleInboundWhatsApp (inbox, bot, SLA, opt-out).
//
// Acuse rápido (2026-10-12), igual que webhooks/meta-dm: Meta reintenta si el 200 no llega
// a tiempo, y antes este POST esperaba al bot (Claude + envío por Graph) de cada contacto
// del batch antes de responder. Ahora la ingesta (inbox, media, acuses, BSUID) sigue antes
// del 200 —el mensaje queda persistido— y el bot se agenda con runAfterResponse para
// después. El costo: si el bot falla ahí, Meta ya no reintenta; el mensaje ya está en el
// inbox y el fallo sale en el console.error de esa tarea.
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import prisma from "@/lib/db";
import { handleInboundWhatsApp } from "@/lib/twilio/whatsapp";
import { resolveWaMediaToStorage } from "@/lib/whatsapp/media";
import { mediaTypeFromWaType } from "@/lib/messaging/media";
import { resolveConnectorByPhoneNumberId, getWhatsAppCredentials } from "@/lib/whatsapp/accounts";
import { secretosIgualesRecortados } from "@/lib/crypto/secretos";
import { runAfterResponse } from "@/lib/runtime/after-response";
import { recordBotSilence } from "@/lib/messaging/send-failure";
import { unknownWhatsAppNumberReason } from "@/lib/messaging/unregistered-account";
import { extractWaBody, waMediaRef, type WaMessageContent } from "@/lib/whatsapp/message-body";
import {
  handleAccountUpdate,
  handleHistory,
  handleSmbAppStateSync,
  handleSmbMessageEchoes,
  type AccountUpdateValue,
  type EchoesValue,
  type HistoryValue,
  type StateSyncValue,
} from "@/lib/whatsapp/coex/webhook";

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

// Texto y media del mensaje: lib/whatsapp/message-body.ts (2026-10-14), compartido con los ecos
// y el historial de la coexistencia.
interface MetaMessage extends WaMessageContent {
  id: string;
  from: string;
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

/**
 * Motivo de la nota cuando el número que recibió el mensaje no es de ninguna cuenta ni el
 * general (2026-10-12). El env solo se COMPARA, nunca se muestra: lo único que se dice de él
 * es si está vacío, que es justo el caso en el que todo número parece desconocido.
 */
function unknownNumberReason(phoneNumberId: string, displayNumber: string | null, lookupFailed: boolean): string {
  // El texto vive en lib/messaging/unregistered-account (2026-10-12): el panel de leads huérfanos
  // lo lee con la misma pieza que lo arma, para que no se desalineen.
  return unknownWhatsAppNumberReason({
    phoneNumberId,
    displayNumber,
    lookupFailed,
    generalNumberConfigured: !!process.env.META_WA_PHONE_NUMBER_ID?.trim(),
  });
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
      /** WABA. Lo usa `account_update`, que no trae metadata del número. */
      id?: string;
      changes?: Array<{
        /** messages | smb_message_echoes | history | smb_app_state_sync | account_update | … */
        field?: string;
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
  // Coexistencia (2026-10-14): historial y libreta se procesan después del 200.
  const deferred: Array<{ field: string; run: () => Promise<unknown> }> = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Sin `field` = messages: es el formato de siempre (y el de las pruebas).
      const field = change.field ?? "messages";
      if (field === "account_update") {
        // handleAccountUpdate nunca lanza: el estado de la cuenta no debe tumbar el lote.
        await handleAccountUpdate(entry.id, value as AccountUpdateValue);
        continue;
      }
      if (COEX_FIELDS.has(field)) {
        await routeCoexField(field, value, deferred);
        continue;
      }
      if (field !== "messages") continue; // campos que este webhook no usa

      // Cuenta receptora (2026-07-25): metadata.phone_number_id identifica a QUÉ número
      // de WhatsApp llegó el mensaje → conector WHATSAPP (config.phoneNumberId) → el
      // Inbox muestra "WhatsApp · Marca" igual que IG/Messenger. Best-effort: sin
      // conector configurado todo fluye como antes (connectorId null).
      let connectorId: string | null = null;
      let connectorToken: string | null = null;
      let unknownNumber = false;
      let lookupFailed = false;
      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      if (phoneNumberId) {
        try {
          const conn = await resolveConnectorByPhoneNumberId(phoneNumberId);
          connectorId = conn?.id ?? null;
          connectorToken = conn ? getWhatsAppCredentials(conn)?.accessToken ?? null : null;
        } catch (err) {
          lookupFailed = true;
          console.error("[whatsapp-meta] resolución de conector falló:", err);
        }
        // Número que llegó a la app pero no está dado de alta (2026-10-09, spec §4.3): se
        // ingiere para no perderlo, pero el agente NO contesta — respondería desde el número
        // global, o sea desde el WhatsApp de otra marca.
        unknownNumber = !connectorId && phoneNumberId !== process.env.META_WA_PHONE_NUMBER_ID?.trim();
        if (unknownNumber) console.warn("[whatsapp-meta] phone_number_id sin cuenta registrada; sin respuesta automática", { phoneNumberId });
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
          const mediaRef = waMediaRef(msg);
          let stored: { path: string; mimeType: string | null } | null = null;
          if (mediaType && mediaRef?.id) {
            stored = await resolveWaMediaToStorage(mediaRef.id, connectorToken);
          }
          // #827: `wa_id` es el teléfono REAL de este remitente — solo se usa ese, nunca
          // `msg.from` a ciegas, porque fuera de la ventana de 30 días `msg.from` ES el
          // BSUID y tratarlo como teléfono es justo el bug que duplicaba contactos.
          // Sin `wa_id` se manda `From: null` y el BSUID viaja aparte en `WhatsAppUserId`
          // para que el core lo reconozca por ese identificador en vez de inventar uno.
          const entrada = entradaDelRemitente(value.contacts, msg.from);
          const bsuid = entrada?.user_id ?? null;
          const realPhone = entrada?.wa_id ?? null;
          // #748 (2026-10-14): `unknownNumber` también apaga el reparto. Un número que no es de
          // ninguna cuenta ni el general podría ser el de otra marca sin registrar.
          const saved = await handleInboundWhatsApp({
            From: realPhone ? `whatsapp:+${realPhone}` : null,
            WhatsAppUserId: bsuid,
            Body: extractWaBody(msg),
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
          }, { triggerBot: false, ...(unknownNumber ? { route: false } : {}) });
          if (saved?.contactId) {
            if (!unknownNumber) {
              botTargets.set(`${saved.contactId}:${connectorId ?? ""}`, { contactId: saved.contactId, connectorId });
            } else if (phoneNumberId) {
              // 2026-10-12: este silencio solo dejaba un console.warn, y sin acceso a los
              // registros del servidor nadie podía saber por qué el agente no contestó. Ahora
              // queda la nota en la conversación del mensaje. recordBotSilence nunca lanza
              // (la ingesta no se negocia) y deduplica: una nota por conversación cada 24 h.
              await recordBotSilence({
                contactId: saved.contactId,
                conversationId: saved.conversationId ?? null,
                channel: "WHATSAPP",
                reason: unknownNumberReason(phoneNumberId, value.metadata?.display_phone_number ?? null, lookupFailed),
              });
            }
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
  // deciden si procede: status BOT, opt-out, canal habilitado, staleness). Después del
  // 200: Meta exige el acuse rápido y reintenta si no llega (ver cabecera).
  const bots = [...botTargets.values()];
  if (bots.length > 0) runAfterResponse(() => responderConElBot(bots));
  if (deferred.length > 0) runAfterResponse(() => procesarCoexistencia(deferred));

  return NextResponse.json({ ok: true, processed });
}

/** Campos de la coexistencia que llegan con metadata del número (account_update va aparte). */
const COEX_FIELDS = new Set(["smb_message_echoes", "history", "smb_app_state_sync"]);

/**
 * Ecos, historial y libreta de un número conectado en coexistencia. Solo con una cuenta ACTIVA de
 * ese número: sin ella no hay a qué conversación ni a qué marca pegarlo, y guardar ecos o historial
 * de un número que nadie dio de alta sería guardar chats ajenos. El eco se guarda ya (el asesor
 * espera verlo en la bandeja); historial y libreta, después del 200.
 */
async function routeCoexField(
  field: string,
  value: unknown,
  deferred: Array<{ field: string; run: () => Promise<unknown> }>,
): Promise<void> {
  const phoneNumberId = (value as { metadata?: { phone_number_id?: string } }).metadata?.phone_number_id;
  if (!phoneNumberId) return;
  let conn: Awaited<ReturnType<typeof resolveConnectorByPhoneNumberId>> = null;
  try {
    conn = await resolveConnectorByPhoneNumberId(phoneNumberId);
  } catch (err) {
    console.error(`[whatsapp-meta] ${field}: resolución de conector falló:`, err);
    return;
  }
  if (!conn) {
    console.warn(`[whatsapp-meta] ${field} de un número sin cuenta activa: se descarta`, { phoneNumberId });
    return;
  }
  const connector = conn;
  if (field === "smb_message_echoes") {
    await handleSmbMessageEchoes(value as EchoesValue, connector);
  } else if (field === "history") {
    deferred.push({ field, run: () => handleHistory(value as HistoryValue, connector) });
  } else if (field === "smb_app_state_sync") {
    deferred.push({ field, run: () => handleSmbAppStateSync(value as StateSyncValue, connector) });
  }
}

/** Corre después del 200. Cada trozo con su try/catch: uno que revienta no frena al resto. */
async function procesarCoexistencia(tareas: Array<{ field: string; run: () => Promise<unknown> }>): Promise<void> {
  for (const t of tareas) {
    try {
      await t.run();
    } catch (err) {
      console.error(`[whatsapp-meta] ${t.field} (después del 200):`, err);
    }
  }
}

/** Corre después del 200. Cada contacto con su try/catch: uno que revienta no frena al resto. */
async function responderConElBot(bots: Array<{ contactId: string; connectorId: string | null }>): Promise<void> {
  for (const t of bots) {
    try {
      const { botRespond } = await import("@/lib/bot/bot-respond");
      await botRespond(t.contactId, { channel: "WHATSAPP", connectorId: t.connectorId });
    } catch (err) {
      console.error("[whatsapp-meta] botRespond:", err);
    }
  }
}
