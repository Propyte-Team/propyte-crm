// Campos de webhook de la coexistencia (2026-10-14): ecos de la app, historial, libreta y estado
// de la cuenta. Spec: docs/superpowers/specs/2026-10-14-whatsapp-coexistencia-design.md §6.
//
// Regla común: NADA de esto crea contactos. El eco y el historial solo se guardan si el otro
// lado ya es un contacto vivo del CRM (decisión 3 del dueño, también para números de marca); la
// libreta solo le pone nombre a un contacto que ya existe y sigue con el provisional. Lo que no
// es de un contacto conocido se descarta sin escribir nada — ni texto, ni media, ni rastro.
//
// Quién llama a qué y cuándo lo decide el route: el eco se guarda antes del 200 (son pocos y el
// asesor espera verlo); el historial y la libreta corren después del 200 porque un solo webhook
// de historial puede traer miles de mensajes (la doc recomienda capturar y procesar aparte).
import prisma from "@/lib/db";
import type { LeadConnector, MessageStatus, Prisma } from "@prisma/client";
import { findWhatsAppContact, handleInboundMessage } from "@/lib/messaging/core";
import { PLACEHOLDER_LASTNAME } from "@/lib/messaging/types";
import { mediaTypeFromWaType } from "@/lib/messaging/media";
import { normalizePhone } from "@/lib/twilio/utils";
import { getWhatsAppCredentials } from "@/lib/whatsapp/accounts";
import { resolveWaMediaToStorage } from "@/lib/whatsapp/media";
import { extractWaBody, waMediaRef, type WaMessageContent } from "@/lib/whatsapp/message-body";
import { usuarioRuteableWhere } from "@/lib/workflows/ruteables";
import { mergeCoexStateSafe } from "./state";
import { disconnectionReasonText, readCoexState, type CoexAccountState } from "./status";

// ─────────────────────────── Tipos de los payloads ───────────────────────────

interface Metadata {
  display_phone_number?: string;
  phone_number_id?: string;
}

export interface WaPayloadMessage extends WaMessageContent {
  id: string;
  from?: string;
  /** Solo en ecos (y en mensajes del historial enviados por el negocio). */
  to?: string;
  timestamp?: string;
  history_context?: { status?: string };
}

export interface EchoesValue {
  metadata?: Metadata;
  message_echoes?: WaPayloadMessage[];
}

export interface HistoryValue {
  metadata?: Metadata;
  history?: Array<{
    metadata?: { phase?: number; chunk_order?: number; progress?: number };
    threads?: Array<{ id?: string; messages?: WaPayloadMessage[] }>;
    errors?: Array<{ code?: number; title?: string; message?: string }>;
  }>;
  /** Webhook aparte con el archivo de un mensaje de media del historial (últimos 14 días). */
  messages?: WaPayloadMessage[];
}

export interface StateSyncValue {
  metadata?: Metadata;
  state_sync?: Array<{
    type?: string;
    action?: string;
    contact?: { full_name?: string; first_name?: string; phone_number?: string };
  }>;
}

export interface AccountUpdateValue {
  event?: string;
  phone_number?: string;
  disconnection_info?: { reason?: string; initiated_by?: string };
}

/** Código del historial cuando el negocio no lo compartió («History sync is turned off»). */
export const HISTORY_DECLINED_CODE = 2593109;

// ─────────────────────────── Utilidades ───────────────────────────

const digitsOf = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/**
 * El otro lado de un chat a partir de lo que trae Meta: un teléfono (solo dígitos, con o sin «+»)
 * o un BSUID (país + punto + alfanuméricos, p. ej. «US.1349…»). Un BSUID NUNCA se trata como
 * teléfono (#827): un `endsWith` de sus últimos 10 caracteres podría casar con otra persona.
 */
export function counterpartOf(raw: string): { senderId: string; isPhone: boolean; bsuid: string | null } {
  const trimmed = raw.trim();
  if (/^\+?\d{8,15}$/.test(trimmed)) return { senderId: normalizePhone(trimmed), isPhone: true, bsuid: null };
  return { senderId: trimmed, isPhone: false, bsuid: trimmed };
}

function findContactFor(raw: string) {
  const who = counterpartOf(raw);
  return findWhatsAppContact(who.senderId, { userId: who.bsuid, senderIsPhone: who.isPhone }).then((contact) => ({ who, contact }));
}

/** Descarga la media de un mensaje al bucket. Solo se llama cuando ya se sabe que hay contacto. */
async function storeMedia(msg: WaMessageContent, token: string | null) {
  const mediaType = mediaTypeFromWaType(msg.type);
  const ref = waMediaRef(msg);
  if (!mediaType || !ref?.id) return null;
  const stored = await resolveWaMediaToStorage(ref.id, token);
  if (!stored) return null;
  return {
    mediaUrl: stored.path,
    mediaType,
    mediaMimeType: stored.mimeType ?? ref.mime_type ?? null,
    mediaFilename: ref.filename ?? null,
  };
}

function tokenOf(connector: LeadConnector): string | null {
  return getWhatsAppCredentials(connector)?.accessToken ?? null;
}

// ─────────────────────────── smb_message_echoes ───────────────────────────

/**
 * Mensajes que el negocio mandó desde la app del teléfono. Se guardan como saliente de asesor en
 * la conversación de esa cuenta (handleEchoMessage del core: deduplica por wamid, toma el hilo si
 * estaba en BOT para que el bot no hable encima, cumple el SLA). Sin contacto conocido NO se guarda:
 * el negocio escribió primero a alguien que el CRM no conoce, y los ecos nunca crean contactos
 * (mismo criterio que los de IG/Messenger). La media se descarga solo después de saber que hay
 * contacto. Devuelve cuántos ecos se guardaron. Nunca lanza.
 */
export async function handleSmbMessageEchoes(value: EchoesValue, connector: LeadConnector): Promise<number> {
  let stored = 0;
  const token = tokenOf(connector);
  for (const echo of value.message_echoes ?? []) {
    try {
      if (!echo?.id || !echo.to) continue;
      const { who, contact } = await findContactFor(echo.to);
      if (!contact) {
        // Sin el número: es el chat de alguien que no está en el CRM.
        console.info(`[whatsapp-coex] eco ${echo.id} a un desconocido: no se guarda`);
        continue;
      }
      const media = await storeMedia(echo, token);
      const saved = await handleInboundMessage({
        channel: "WHATSAPP",
        senderId: who.senderId,
        senderIdIsPhone: who.isPhone,
        whatsappUserId: who.bsuid,
        externalMessageId: echo.id,
        text: extractWaBody(echo),
        isEcho: true,
        connectorId: connector.id,
        ...(media ?? {}),
      });
      if (saved) stored++;
    } catch (err) {
      console.error(`[whatsapp-coex] eco ${echo?.id ?? "?"} no guardado:`, err instanceof Error ? err.message : err);
    }
  }
  return stored;
}

// ─────────────────────────── history ───────────────────────────

const HISTORY_STATUS: Record<string, MessageStatus> = {
  DELIVERED: "DELIVERED",
  READ: "READ",
  PLAYED: "READ",
  SENT: "SENT",
  PENDING: "QUEUED",
  ERROR: "FAILED",
};

function timestampOf(raw: string | undefined): Date | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

export interface HistoryResult {
  imported: number;
  threadsImported: number;
  threadsDiscarded: number;
  mediaUpdated: number;
}

/** El webhook aparte con la media: solo completa mensajes que YA se importaron (de un contacto conocido). */
async function attachHistoryMedia(messages: WaPayloadMessage[], connector: LeadConnector): Promise<number> {
  let updated = 0;
  const token = tokenOf(connector);
  for (const m of messages) {
    try {
      if (!m?.id) continue;
      const existing = await prisma.message.findFirst({
        where: { externalMessageId: m.id, conversation: { connectorId: connector.id } },
        select: { id: true, mediaUrl: true },
      });
      if (!existing || existing.mediaUrl) continue; // no importado (desconocido) o ya tiene archivo
      const media = await storeMedia(m, token);
      if (!media) continue;
      await prisma.message.update({ where: { id: existing.id }, data: { ...media, body: extractWaBody(m) } });
      updated++;
    } catch (err) {
      console.error(`[whatsapp-coex] media del historial ${m?.id ?? "?"} no guardada:`, err instanceof Error ? err.message : err);
    }
  }
  return updated;
}

/** Marca de la cuenta en el contacto, igual que el inbound del core. Best-effort. */
async function attachConnectorBrand(contactId: string, connector: LeadConnector): Promise<void> {
  try {
    const { getDefaultBrandId } = await import("@/lib/brands/resolve");
    const brandId = connector.brandId ?? (await getDefaultBrandId());
    if (!brandId) return;
    const { attachBrand } = await import("@/lib/brands/attach");
    await attachBrand({ contactId, brandId, connectorId: connector.id, contactIsNew: false });
  } catch (err) {
    console.error("[whatsapp-coex] marca del contacto del historial no registrada:", err instanceof Error ? err.message : err);
  }
}

/** Importa un hilo del historial. Devuelve cuántos mensajes nuevos quedaron, o null si se descartó. */
async function importThread(
  thread: { id?: string; messages?: WaPayloadMessage[] },
  connector: LeadConnector,
): Promise<number | null> {
  if (!thread.id || !thread.messages?.length) return 0;
  const { who, contact } = await findContactFor(thread.id);
  if (!contact) return null; // decisión 3: solo contactos que ya existen

  const { ensureConversation } = await import("@/lib/messaging/conversations");
  const conv = await ensureConversation({ contactId: contact.id, channel: "WHATSAPP", connectorId: connector.id });

  const ids = thread.messages.map((m) => m?.id).filter((id): id is string => typeof id === "string" && id.length > 0);
  // Dedup por wamid contra los dos sitios donde vive: `externalMessageId` (entrantes y ecos) y
  // `twilioSid` (lo que mandó el CRM). El webhook normal y el historial se pisan en la fase 0.
  const already = await prisma.message.findMany({
    where: { OR: [{ externalMessageId: { in: ids } }, { twilioSid: { in: ids } }] },
    select: { externalMessageId: true, twilioSid: true },
  });
  const seen = new Set(already.flatMap((m) => [m.externalMessageId, m.twilioSid]).filter(Boolean) as string[]);

  const userDigits = digitsOf(thread.id);
  let lastAt: Date | null = null;
  let lastInboundAt: Date | null = null;
  const rows: Prisma.MessageCreateManyInput[] = [];
  for (const m of thread.messages) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    const at = timestampOf(m.timestamp) ?? new Date();
    // Saliente si trae `to` (solo los del negocio) o si no lo escribió el usuario del hilo.
    const outbound = m.to != null || (userDigits !== "" ? digitsOf(m.from) !== userDigits : m.from !== thread.id);
    rows.push({
      contactId: contact.id,
      userId: contact.assignedToId ?? null,
      channel: "WHATSAPP",
      direction: outbound ? "OUTBOUND" : "INBOUND",
      body: extractWaBody(m),
      externalMessageId: m.id,
      status: HISTORY_STATUS[m.history_context?.status ?? ""] ?? "DELIVERED",
      externalPhone: who.senderId,
      conversationId: conv.id,
      sender: outbound ? "ADVISOR" : "CONTACT",
      aiGenerated: false,
      createdAt: at,
    });
    if (!lastAt || at > lastAt) lastAt = at;
    if (!outbound && (!lastInboundAt || at > lastInboundAt)) lastInboundAt = at;
  }
  if (rows.length === 0) return 0;

  // Es pasado: sin bot, sin SLA, sin actividades, sin avisos, sin «no leídos».
  const res = await prisma.message.createMany({ data: rows, skipDuplicates: true });

  // Las fechas del hilo solo avanzan (un trozo viejo no debe hacer «más antiguo» un hilo vivo).
  if (lastAt) {
    await prisma.conversation.updateMany({
      where: { id: conv.id, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: lastAt } }] },
      data: { lastMessageAt: lastAt },
    });
  }
  if (lastInboundAt) {
    await prisma.conversation.updateMany({
      where: { id: conv.id, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: lastInboundAt } }] },
      data: { lastInboundAt },
    });
  }
  await attachConnectorBrand(contact.id, connector);
  return res.count;
}

/** Avance de la sincronización: nunca retrocede ni deshace un COMPLETE (los trozos llegan desordenados). */
async function recordHistoryProgress(connector: LeadConnector, progress: number | undefined, phase: number | undefined) {
  if (typeof progress !== "number") return;
  const fresh = await prisma.leadConnector
    .findUnique({ where: { id: connector.id }, select: { config: true } })
    .catch(() => null);
  const prev = readCoexState(fresh?.config ?? connector.config)?.historySync;
  if (prev?.state === "COMPLETE" || prev?.state === "DECLINED") return;
  const best = Math.max(progress, typeof prev?.progress === "number" ? prev.progress : 0);
  await mergeCoexStateSafe(connector.id, {
    historySync: {
      state: best >= 100 ? "COMPLETE" : "IN_PROGRESS",
      at: new Date().toISOString(),
      progress: best,
      ...(typeof phase === "number" ? { phase } : {}),
    },
  });
}

/**
 * Historial de la app (hasta 180 días). Por hilo: si el otro lado es un contacto vivo se importa
 * a la conversación de esta cuenta; si no, el hilo entero se descarta sin escribir nada. Nunca lanza.
 */
export async function handleHistory(value: HistoryValue, connector: LeadConnector): Promise<HistoryResult> {
  const result: HistoryResult = { imported: 0, threadsImported: 0, threadsDiscarded: 0, mediaUpdated: 0 };

  if (value.messages?.length) result.mediaUpdated = await attachHistoryMedia(value.messages, connector);

  for (const chunk of value.history ?? []) {
    if (chunk.errors?.length) {
      const declined = chunk.errors.some((e) => e.code === HISTORY_DECLINED_CODE);
      const first = chunk.errors[0];
      await mergeCoexStateSafe(connector.id, {
        historySync: declined
          ? { state: "DECLINED", at: new Date().toISOString() }
          : { state: "FAILED", at: new Date().toISOString(), error: (first?.title || first?.message || `código ${first?.code ?? "?"}`).slice(0, 200) },
      });
      continue;
    }
    for (const thread of chunk.threads ?? []) {
      try {
        const n = await importThread(thread, connector);
        if (n === null) result.threadsDiscarded++;
        else {
          result.threadsImported++;
          result.imported += n;
        }
      } catch (err) {
        console.error("[whatsapp-coex] hilo del historial no importado:", err instanceof Error ? err.message : err);
      }
    }
    await recordHistoryProgress(connector, chunk.metadata?.progress, chunk.metadata?.phase);
  }

  // Solo conteos: ni números ni textos en el registro.
  console.info(
    `[whatsapp-coex] historial ${connector.id}: ${result.imported} mensajes de ${result.threadsImported} hilos importados, ` +
      `${result.threadsDiscarded} hilos descartados (sin contacto), ${result.mediaUpdated} archivos`,
  );
  return result;
}

// ─────────────────────────── smb_app_state_sync ───────────────────────────

/** ¿El contacto sigue con el nombre provisional del alta por WhatsApp? */
export function hasPlaceholderName(contact: { firstName: string; lastName: string }): boolean {
  return contact.lastName === PLACEHOLDER_LASTNAME;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || PLACEHOLDER_LASTNAME };
}

/**
 * Libreta de la app. NUNCA crea contactos: solo le pone el nombre de la libreta a un contacto que
 * ya existe y sigue con el apellido provisional. Un nombre que puso una persona no se toca.
 * Devuelve cuántos contactos se renombraron. Nunca lanza.
 */
export async function handleSmbAppStateSync(value: StateSyncValue, connector: LeadConnector): Promise<number> {
  let renamed = 0;
  for (const item of value.state_sync ?? []) {
    try {
      if (item?.type !== "contact" || item.action !== "add") continue;
      const phone = item.contact?.phone_number;
      const full = item.contact?.full_name?.trim();
      if (!phone || !full) continue;
      const { contact } = await findContactFor(phone);
      if (!contact || !hasPlaceholderName(contact)) continue;
      const { withChangeSource } = await import("@/lib/audit/change-context");
      await withChangeSource({ source: "whatsapp_libreta" }, (tx) =>
        tx.contact.update({ where: { id: contact.id }, data: splitName(full) }),
      );
      renamed++;
    } catch (err) {
      console.error("[whatsapp-coex] nombre de la libreta no aplicado:", err instanceof Error ? err.message : err);
    }
  }
  if (renamed) console.info(`[whatsapp-coex] libreta ${connector.id}: ${renamed} contactos con nombre`);
  return renamed;
}

// ─────────────────────────── account_update ───────────────────────────

const ACCOUNT_EVENT_STATE: Record<string, CoexAccountState> = {
  PARTNER_REMOVED: "DISCONNECTED",
  ACCOUNT_OFFBOARDED: "OFFBOARDED",
  ACCOUNT_RECONNECTED: "CONNECTED",
};

export function accountEventState(event: string | undefined): CoexAccountState | null {
  return (event && ACCOUNT_EVENT_STATE[event]) || null;
}

/** A quién se avisa: los ADMIN que son personas (activos, no `.local`). */
async function accountNoticeRecipients(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", ...usuarioRuteableWhere() },
    select: { id: true },
  });
  return admins.map((u) => u.id);
}

function accountNotice(state: CoexAccountState, name: string, display: string, reason: string | null) {
  if (state === "DISCONNECTED") {
    return {
      title: `WhatsApp desconectado: ${name}`,
      message:
        `El negocio desconectó ${display} desde la app de WhatsApp Business${reason ? ` (${reason})` : ""}. ` +
        "Sus mensajes ya no entran al CRM. Para volver, conéctalo otra vez desde Conexiones.",
    };
  }
  if (state === "OFFBOARDED") {
    return {
      title: `WhatsApp desconectado temporalmente: ${name}`,
      message:
        `${display} cambió de teléfono o reinstaló WhatsApp Business. Meta lo reconecta solo en unos minutos; ` +
        "mientras tanto no salen mensajes desde el CRM.",
    };
  }
  return { title: `WhatsApp reconectado: ${name}`, message: `${display} volvió a conectarse. Los mensajes del CRM salen otra vez.` };
}

/**
 * Estado de la cuenta (`account_update`, `entry.id` = WABA). Solo tres eventos importan aquí:
 * PARTNER_REMOVED (el negocio se desconectó desde la app), ACCOUNT_OFFBOARDED (cambio de teléfono;
 * se reconecta solo) y ACCOUNT_RECONNECTED. La cuenta pasa a ERROR con el motivo a la vista, o
 * vuelve a ACTIVA si la habíamos puesto en ERROR por esto (una pausa manual no se deshace). Se avisa
 * solo cuando el estado CAMBIA: una reentrega del mismo webhook no repite el aviso. Nunca lanza.
 */
export async function handleAccountUpdate(wabaId: string | undefined, value: AccountUpdateValue): Promise<number> {
  const target = accountEventState(value.event);
  if (!target || !wabaId) return 0;
  let changed = 0;
  try {
    const all = await prisma.leadConnector.findMany({
      where: { provider: "WHATSAPP", deletedAt: null, config: { path: ["wabaId"], equals: wabaId } },
      select: { id: true, name: true, status: true, config: true },
    });
    // Varias cuentas en la misma WABA: si el evento trae el número, solo la de ese número.
    const phone = digitsOf(value.phone_number);
    const byPhone = phone
      ? all.filter((c) => digitsOf((c.config as { displayPhone?: string } | null)?.displayPhone) === phone)
      : [];
    const targets = byPhone.length ? byPhone : all;

    for (const c of targets) {
      const prev = readCoexState(c.config);
      if (!prev) continue; // alta manual: no es de coexistencia
      if (prev.accountState === target) continue; // reentrega o estado ya aplicado

      const now = new Date().toISOString();
      const reason = disconnectionReasonText(value.disconnection_info?.reason);
      const display = (c.config as { displayPhone?: string } | null)?.displayPhone || c.name;
      if (target === "CONNECTED") {
        if (c.status === "ERROR") {
          await prisma.leadConnector.update({ where: { id: c.id }, data: { status: "ACTIVE", lastError: null, errorCount: 0 } });
        }
      } else {
        await prisma.leadConnector.update({
          where: { id: c.id },
          data: {
            status: "ERROR",
            lastError:
              target === "DISCONNECTED"
                ? `Desconectado desde la app de WhatsApp Business${reason ? `: ${reason}` : ""}. Vuelve a conectar el número.`
                : "Desconectado temporalmente (cambio de teléfono o reinstalación). Meta lo reconecta solo.",
          },
        });
      }
      await mergeCoexStateSafe(c.id, {
        accountState: target,
        accountEventAt: now,
        disconnection:
          target === "DISCONNECTED"
            ? { reason: value.disconnection_info?.reason ?? null, initiatedBy: value.disconnection_info?.initiated_by ?? null }
            : null,
      });
      changed++;

      try {
        const userIds = await accountNoticeRecipients();
        const notice = accountNotice(target, c.name, display, reason);
        if (userIds.length) {
          await prisma.notification.createMany({
            data: userIds.map((userId) => ({ userId, ...notice, type: "whatsapp_account", link: "/conexiones" })),
          });
        }
      } catch (err) {
        console.error("[whatsapp-coex] aviso de estado de la cuenta no enviado:", err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error("[whatsapp-coex] account_update no aplicado:", err instanceof Error ? err.message : err);
  }
  return changed;
}
