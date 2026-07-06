import type { ConversationChannel } from "@prisma/client";

/** Canales sociales/mensajería soportados por el core agnóstico. */
export type MessagingChannel = Extract<ConversationChannel, "WHATSAPP" | "INSTAGRAM" | "MESSENGER">;

/** Mensaje entrante ya normalizado, agnóstico del proveedor. */
export interface IncomingMessage {
  channel: MessagingChannel;
  /** Id estable del remitente en el canal: E.164 (WA), IGSID (IG) o PSID (Messenger). */
  senderId: string;
  /** Id del mensaje en el proveedor (wamid/mid) — para dedup idempotente. */
  externalMessageId: string;
  text: string;
  mediaUrl?: string | null;
  /** Nombre/usuario del perfil si el adapter lo resolvió (best-effort). */
  profileName?: string | null;
  /** Id del conector (cuenta WhatsApp / página FB) que recibió el mensaje. */
  connectorId?: string | null;
}

/** Resultado de un envío saliente por un adapter. */
export interface SendResult {
  externalMessageId: string;
  status: "SENT" | "QUEUED";
}
