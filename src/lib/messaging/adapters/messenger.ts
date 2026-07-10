import type { IncomingMessage } from "../types";
import { sendGraphMessage } from "../graph";

interface MetaMessagingEvent {
  sender?: { id?: string };
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: Array<{ payload?: { url?: string } }> };
}
interface MetaWebhookBody { object?: string; entry?: Array<{ id?: string; messaging?: MetaMessagingEvent[] }> }

/** Normaliza un webhook `object: "page"` (Messenger) a IncomingMessage[]. */
export function parseMessengerWebhook(body: MetaWebhookBody): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      if (!m || m.is_echo || !m.mid || !ev.sender?.id) continue;
      out.push({
        channel: "MESSENGER",
        senderId: ev.sender.id,
        externalMessageId: m.mid,
        text: m.text ?? (m.attachments?.length ? "[Adjunto]" : "[mensaje]"),
        mediaUrl: m.attachments?.[0]?.payload?.url ?? null,
        accountId: entry.id ?? null,
      });
    }
  }
  return out;
}

/** Envía a un PSID por la Send API (page token del conector). */
export function sendMessenger(pageToken: string, psid: string, text: string) {
  return sendGraphMessage(pageToken, psid, text);
}
