// Expansión compartida IG/Messenger: un webhook message → N IncomingMessage
// (uno por attachment de media; share/fallback se degradan a texto/link).
import type { IncomingMessage, MessagingChannel } from "../types";
import { mediaTypeFromAttachment, mediaPlaceholderBody } from "../media";

export interface MetaAttachment {
  type?: string;
  payload?: { url?: string; sticker_id?: number };
}
export interface MetaInboundMessage {
  mid: string;
  text?: string;
  attachments?: MetaAttachment[];
}

type SocialChannel = Extract<MessagingChannel, "INSTAGRAM" | "MESSENGER">;

export function expandMetaMessage(
  base: { channel: SocialChannel; senderId: string; accountId: string | null },
  m: MetaInboundMessage
): IncomingMessage[] {
  const atts = m.attachments ?? [];
  const media = atts.flatMap((a) => {
    const type = mediaTypeFromAttachment(a);
    const url = a.payload?.url;
    return type && url ? [{ url, type }] : [];
  });

  if (!media.length) {
    // texto puro, o adjunto no-media (share/fallback) → link como texto
    const shareUrl = atts.find((a) => a.payload?.url)?.payload?.url;
    return [
      {
        ...base,
        externalMessageId: m.mid,
        text: m.text ?? shareUrl ?? (atts.length ? "[Adjunto]" : "[mensaje]"),
        mediaUrl: null,
      },
    ];
  }

  // 1 mensaje por adjunto; el mid original va en el primero (dedup), los demás llevan sufijo
  return media.map((x, i) => ({
    ...base,
    externalMessageId: i === 0 ? m.mid : `${m.mid}#${i}`,
    text: i === 0 && m.text ? m.text : mediaPlaceholderBody(x.type),
    mediaUrl: x.url,
    mediaType: x.type,
  }));
}
