import type { IncomingMessage } from "../types";
import { sendGraphMessage } from "../graph";
import { expandMetaMessage, type MetaAttachment } from "./meta-attachments";
import { mediaTypeFromAttachment } from "../media";

interface MetaReferral {
  ref?: string;
  source?: string;
  type?: string;
  ad_id?: string;
}
interface MetaPostback {
  title?: string;
  payload?: string;
  referral?: MetaReferral;
}
interface MetaMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    app_id?: string | number;
    attachments?: MetaAttachment[];
  };
  postback?: MetaPostback;
  referral?: MetaReferral;
  timestamp?: number;
  read?: unknown;
  delivery?: unknown;
}
interface MetaEntry { id?: string; messaging?: MetaMessagingEvent[] }
interface MetaWebhookBody { object?: string; entry?: MetaEntry[] }

/** Mapea el referral crudo de Meta (ref/source/type/ad_id) al shape camelCase de IncomingMessage. */
function mapReferral(r?: MetaReferral): IncomingMessage["referral"] | undefined {
  if (!r) return undefined;
  const mapped = { ref: r.ref, source: r.source, type: r.type, adId: r.ad_id };
  if (!mapped.ref && !mapped.source && !mapped.type && !mapped.adId) return undefined;
  return mapped;
}

/** Normaliza un webhook `object: "instagram"` a IncomingMessage[] (1 por adjunto de media). */
export function parseInstagramWebhook(body: MetaWebhookBody): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      const senderId = ev.sender?.id;
      if (!senderId) continue;
      // Referral: puede venir junto a un mensaje real (click-to-IG-DM sin Get
      // Started) o anidado en postback.referral (con Get Started configurado).
      const referral = mapReferral(ev.referral ?? ev.postback?.referral);

      const m = ev.message;

      // Echo (Caso 4): envío de la Página desde otra superficie (Business Suite /
      // app / el propio CRM). El dueño del hilo es el RECIPIENT (el usuario), no
      // el sender (la Página) — se normaliza senderId = recipient.id.
      if (m?.is_echo) {
        if (!m.mid || !ev.recipient?.id) continue;
        const att = m.attachments?.[0];
        out.push({
          channel: "INSTAGRAM",
          senderId: ev.recipient.id,
          externalMessageId: m.mid,
          text: m.text ?? "(adjunto)",
          mediaUrl: att?.payload?.url ?? null,
          ...(att ? { mediaType: mediaTypeFromAttachment(att) } : {}),
          accountId: entry.id ?? null,
          isEcho: true,
          echoAppId: m.app_id != null ? String(m.app_id) : null,
        });
        continue;
      }

      if (m && m.mid) {
        const msgs = expandMetaMessage(
          { channel: "INSTAGRAM", senderId, accountId: entry.id ?? null },
          { mid: m.mid, text: m.text, attachments: m.attachments }
        );
        // el referral (ads/ig.me) es señal de linking del hilo: va en el primer mensaje
        if (referral && msgs[0]) msgs[0].referral = referral;
        out.push(...msgs);
        continue;
      }

      // Postback (ej. "Get Started") sin message: registra el evento igual
      // para que el hilo lo vea, y arrastra el referral anidado si vino.
      if (ev.postback) {
        out.push({
          channel: "INSTAGRAM",
          senderId,
          externalMessageId: `postback:${senderId}:${ev.timestamp ?? Date.now()}`,
          text: ev.postback.title ?? ev.postback.payload ?? "[postback]",
          mediaUrl: null,
          accountId: entry.id ?? null,
          ...(referral ? { referral } : {}),
        });
      }
      // Evento de solo referral (messaging_referrals sin message/postback): no
      // hay nada capturable todavía (sin mensaje real que registrar en el hilo).
    }
  }
  return out;
}

/** Envía a un IGSID por la Send API (page token del conector). */
export function sendInstagram(pageToken: string, igsid: string, text: string) {
  return sendGraphMessage(pageToken, igsid, text);
}
