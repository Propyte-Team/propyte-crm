// Reglas de media del inbox (puras): qué tipo soporta cada canal saliente,
// límites de tamaño de Meta, y mapeos a los shapes de Graph / WhatsApp Cloud.
export type ChatMediaType = "image" | "gif" | "audio" | "video" | "document" | "sticker";

export const CHAT_MEDIA_TYPES: ChatMediaType[] = ["image", "gif", "audio", "video", "document", "sticker"];

export interface ChatMedia {
  path: string; // path en bucket chat-media, o URL externa
  type: ChatMediaType;
  filename?: string | null;
  mimeType?: string | null;
}

/** Tipos que cada canal puede ENVIAR por API (recepción renderiza todos). */
export const CHANNEL_MEDIA_SUPPORT: Record<"WHATSAPP" | "INSTAGRAM" | "MESSENGER", ChatMediaType[]> = {
  // WA no tiene GIF nativo; video-send fuera de alcance v1
  WHATSAPP: ["image", "document", "audio", "sticker"],
  // La API de IG DM no soporta archivos (file)
  INSTAGRAM: ["image", "gif", "audio", "video"],
  MESSENGER: ["image", "gif", "audio", "video", "document"],
};

const MB = 1024 * 1024;
/** Límites de Meta por canal (bytes). */
export const MEDIA_SIZE_LIMITS: Record<"WHATSAPP" | "INSTAGRAM" | "MESSENGER", Partial<Record<ChatMediaType, number>>> = {
  WHATSAPP: { image: 5 * MB, audio: 16 * MB, video: 16 * MB, document: 100 * MB, sticker: 500 * 1024 },
  INSTAGRAM: { image: 25 * MB, gif: 25 * MB, audio: 25 * MB, video: 25 * MB },
  MESSENGER: { image: 25 * MB, gif: 25 * MB, audio: 25 * MB, video: 25 * MB, document: 25 * MB },
};

export function isMediaAllowed(channel: string, type: ChatMediaType, sizeBytes?: number): boolean {
  const supported = CHANNEL_MEDIA_SUPPORT[channel as keyof typeof CHANNEL_MEDIA_SUPPORT];
  if (!supported?.includes(type)) return false;
  if (sizeBytes != null) {
    const limit = MEDIA_SIZE_LIMITS[channel as keyof typeof MEDIA_SIZE_LIMITS]?.[type];
    if (limit != null && sizeBytes > limit) return false;
  }
  return true;
}

/** Tipo de chat-media a partir del mime (y canal, para stickers webp de WA). */
export function mediaTypeFromMime(mime: string, channel?: string): ChatMediaType {
  const m = mime.toLowerCase();
  if (m === "image/gif") return "gif";
  if (m === "image/webp") return channel === "WHATSAPP" ? "sticker" : "image";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return "document";
}

/** Tipo de attachment del webhook IG/Messenger → ChatMediaType (null = no es media renderizable). */
export function mediaTypeFromAttachment(att: { type?: string; payload?: { url?: string; sticker_id?: number } }): ChatMediaType | null {
  const url = att.payload?.url ?? "";
  switch (att.type) {
    case "image":
      if (att.payload?.sticker_id != null) return "sticker";
      return /\.gif($|\?)/i.test(url) ? "gif" : "image";
    case "video": return "video";
    case "audio": return "audio";
    case "file": return "document";
    default: return null; // share/fallback/template → se trata como texto/link
  }
}

/** Tipo de mensaje de WhatsApp Cloud (webhook) → ChatMediaType. */
export function mediaTypeFromWaType(waType: string): ChatMediaType | null {
  switch (waType) {
    case "image": return "image";
    case "audio": return "audio";
    case "video": return "video";
    case "document": return "document";
    case "sticker": return "sticker";
    default: return null;
  }
}

/** attachment.type que espera la Send API de Messenger/IG. */
export function graphAttachmentType(type: ChatMediaType): "image" | "audio" | "video" | "file" {
  switch (type) {
    case "image": case "gif": case "sticker": return "image";
    case "audio": return "audio";
    case "video": return "video";
    case "document": return "file";
  }
}

/** `type` del payload de WhatsApp Cloud Send API. */
export function waMessageType(type: ChatMediaType): "image" | "audio" | "video" | "document" | "sticker" {
  switch (type) {
    case "image": case "gif": return "image";
    case "audio": return "audio";
    case "video": return "video";
    case "document": return "document";
    case "sticker": return "sticker";
  }
}

const PLACEHOLDER: Record<ChatMediaType, string> = {
  image: "[Imagen]",
  gif: "[GIF]",
  audio: "[Audio]",
  video: "[Video]",
  document: "[Documento]",
  sticker: "[Sticker]",
};

/** Body placeholder para mensajes que son solo media. */
export function mediaPlaceholderBody(type: ChatMediaType, filename?: string | null): string {
  if (type === "document" && filename) return `[Documento: ${filename}]`;
  return PLACEHOLDER[type];
}
