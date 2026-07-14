import type { ConversationChannel } from "@prisma/client";

/** Canales sociales/mensajería soportados por el core agnóstico. */
export type MessagingChannel = Extract<ConversationChannel, "WHATSAPP" | "INSTAGRAM" | "MESSENGER">;

/** Mensaje entrante ya normalizado, agnóstico del proveedor. */
export interface IncomingMessage {
  channel: MessagingChannel;
  /**
   * Id estable del remitente en el canal: E.164 (WA), IGSID (IG) o PSID (Messenger).
   * DECISIÓN (Caso 4): en un echo (`isEcho: true`) el sender crudo del webhook es
   * la Página; aquí se normaliza a `recipient.id` (el usuario dueño del hilo) para
   * que el resto del pipeline resuelva contacto/conversación sin cambios.
   */
  senderId: string;
  /** Id del mensaje en el proveedor (wamid/mid) — para dedup idempotente. */
  externalMessageId: string;
  text: string;
  mediaUrl?: string | null;
  /** Tipo de media normalizado (image|gif|audio|video|document|sticker) si el mensaje trae adjunto. */
  mediaType?: string | null;
  mediaFilename?: string | null;
  mediaMimeType?: string | null;
  /** Nombre/usuario del perfil si el adapter lo resolvió (best-effort). */
  profileName?: string | null;
  /** Id del conector (cuenta WhatsApp / página FB) que recibió el mensaje. */
  connectorId?: string | null;
  /** Id de la cuenta receptora del webhook: IG Business ID (objeto instagram) o Page ID (objeto page). */
  accountId?: string | null;
  /** Referral de anuncios/m.me (messaging_referrals o postback.referral) — Caso 2 social↔ads linking. */
  referral?: {
    ref?: string;
    source?: string;
    type?: string;
    adId?: string;
  };
  /**
   * true si el evento es un echo (`message.is_echo`): un envío hecho por la Página
   * desde OTRA superficie (Business Suite / app de la Página / el propio CRM).
   * El core lo registra como OUTBOUND humano-externo, nunca como inbound.
   */
  isEcho?: boolean;
  /** `message.app_id` del echo (app que lo envió), si Meta lo incluye. */
  echoAppId?: string | null;
}

/** Resultado de un envío saliente por un adapter. */
export interface SendResult {
  externalMessageId: string;
  status: "SENT" | "QUEUED";
}
