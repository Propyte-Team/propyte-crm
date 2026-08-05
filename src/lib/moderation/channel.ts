// Traducción entre el canal de la conversación y el canal de la lista de bloqueados,
// y resolución del identificador que Meta entiende para cada canal.
import type { ConversationChannel, MessageChannel } from "@prisma/client";

/** ConversationChannel incluye WEB, que no tiene un remitente bloqueable. */
export function toMessageChannel(channel: ConversationChannel): MessageChannel | null {
  switch (channel) {
    case "INSTAGRAM":
      return "INSTAGRAM";
    case "MESSENGER":
      return "MESSENGER";
    case "WHATSAPP":
      return "WHATSAPP";
    case "SMS":
      return "SMS";
    case "WEB":
      return null;
  }
}

export interface ContactIdentifiers {
  instagramId: string | null;
  messengerPsid: string | null;
  phone: string | null;
}

/** SMS devuelve null a propósito: no hay a quién bloquear del lado de Meta. */
export function identifierFor(channel: MessageChannel, contact: ContactIdentifiers): string | null {
  switch (channel) {
    case "INSTAGRAM":
      return contact.instagramId || null;
    case "MESSENGER":
      return contact.messengerPsid || null;
    case "WHATSAPP":
      return contact.phone || null;
    case "SMS":
      return null;
  }
}
