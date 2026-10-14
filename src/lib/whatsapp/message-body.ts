// Texto y media de un mensaje de WhatsApp Cloud tal como llega en un webhook (2026-10-14).
//
// Vivía dentro de app/api/webhooks/whatsapp/meta/route.ts. Se movió aquí sin cambios cuando los
// ecos de la app (`smb_message_echoes`) y el historial de coexistencia (`history`) empezaron a
// traer mensajes con la MISMA forma: una sola regla de «cómo se ve este mensaje en la bandeja»
// para el entrante, el eco y el historial, en vez de tres copias que divergen.

export interface WaMediaRef {
  id?: string;
  caption?: string;
  filename?: string;
  mime_type?: string;
}

export interface WaMessageContent {
  type: string;
  text?: { body?: string };
  image?: WaMediaRef;
  audio?: WaMediaRef;
  video?: WaMediaRef;
  document?: WaMediaRef;
  sticker?: WaMediaRef;
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  /** Mensajes `unsupported`: el motivo (p. ej. 131060 en coexistencia). */
  errors?: Array<{ code?: number }>;
}

/**
 * Coexistencia (2026-10-14): Meta manda un `unsupported` con 131060 cuando el mensaje no se puede
 * reflejar —primer mensaje de alguien nuevo (suele resolverse en segundos) o un equipo vinculado no
 * compatible—. La doc pide decirle al negocio que lo vea en la app.
 */
export const COEX_UNSUPPORTED_CODE = 131060;

/** Referencia de media del mensaje según su tipo (null si es texto/interactivo). */
export function waMediaRef(msg: WaMessageContent): WaMediaRef | null {
  switch (msg.type) {
    case "image": return msg.image ?? null;
    case "audio": return msg.audio ?? null;
    case "video": return msg.video ?? null;
    case "document": return msg.document ?? null;
    case "sticker": return msg.sticker ?? null;
    default: return null;
  }
}

/** Cuerpo legible para la bandeja: el texto, el título del botón o un marcador del adjunto. */
export function extractWaBody(msg: WaMessageContent): string {
  if (msg.text?.body) return msg.text.body;
  if (msg.button?.text) return msg.button.text;
  if (msg.interactive?.button_reply?.title) return msg.interactive.button_reply.title;
  if (msg.interactive?.list_reply?.title) return msg.interactive.list_reply.title;
  if (msg.image) return `[Imagen]${msg.image.caption ? ` ${msg.image.caption}` : ""}`;
  if (msg.audio) return "[Audio]";
  if (msg.video) return `[Video]${msg.video.caption ? ` ${msg.video.caption}` : ""}`;
  if (msg.sticker) return "[Sticker]";
  if (msg.document) return `[Documento${msg.document.filename ? `: ${msg.document.filename}` : ""}]`;
  // Historial de coexistencia: la media llega primero como marcador, sin contenido; el
  // archivo (solo de los últimos 14 días) llega después en otro webhook.
  if (msg.type === "media_placeholder") return "[Archivo]";
  if (msg.type === "unsupported" && msg.errors?.some((e) => e.code === COEX_UNSUPPORTED_CODE)) {
    return "[Mensaje que no se puede mostrar aquí: revísalo en la app de WhatsApp Business]";
  }
  return `[${msg.type}]`;
}
