// Texto de la nota «El agente no contestó» cuando un mensaje llega a una cuenta o a un número que
// no está dado de alta en Conexiones — módulo PURO (2026-10-12).
//
// Por qué vive aquí y no dentro de cada webhook: el panel «Leads huérfanos» (entrega 3 de marcas)
// busca justo estas notas para listar las conversaciones que entraron por una cuenta sin registrar.
// Si el webhook armara el texto por su lado y el panel lo buscara con su propia copia, bastaría con
// cambiar una coma en el webhook para que el panel dejara de encontrarlas sin que nada truene. Con
// el armado y la lectura juntos, unregistered-account.test.ts los cruza.
//
// Los textos son EXACTAMENTE los que ya dejaban los webhooks (sus pruebas los fijan letra por letra).
import { BOT_SILENCE_PREFIX } from "./bot-note-prefix";

/** Inicio del motivo de WhatsApp (después de «El agente no contestó: »). */
const WA_LEAD = "este WhatsApp llegó al número ";
/** Inicio del motivo de Instagram/Messenger. */
const META_LEAD = "este mensaje de ";
const META_ACCOUNT = " llegó a la cuenta ";

/** Prefijos completos de la nota, para buscarla en la base (`startsWith`). */
export const UNREGISTERED_WA_NOTE_PREFIX = `${BOT_SILENCE_PREFIX}: ${WA_LEAD}`;
export const UNREGISTERED_META_NOTE_PREFIX = `${BOT_SILENCE_PREFIX}: ${META_LEAD}`;
/** Lo que distingue la nota de Meta de otros silencios que también empiezan con «este mensaje de». */
export const UNREGISTERED_META_NOTE_MARKER = META_ACCOUNT;

/**
 * Motivo cuando el phone_number_id que recibió el WhatsApp no es de ninguna cuenta ni el general.
 * `generalNumberConfigured` lo calcula el webhook con el env; aquí solo se dice si está vacío
 * (el env nunca se muestra: es justo el caso en el que todo número parece desconocido).
 */
export function unknownWhatsAppNumberReason(args: {
  phoneNumberId: string;
  displayNumber: string | null;
  lookupFailed: boolean;
  generalNumberConfigured: boolean;
}): string {
  const numero = `${args.displayNumber ?? args.phoneNumberId} (id ${args.phoneNumberId})`;
  const base = args.lookupFailed
    ? `${WA_LEAD}${numero}; no se pudo consultar en Conexiones de qué cuenta es (falló la lectura) y no es el número general del CRM.`
    : `${WA_LEAD}${numero}, que no está dado de alta en Conexiones ni es el número general del CRM.`;
  return args.generalNumberConfigured
    ? base
    : `${base} Ojo: el servidor no tiene configurado el número general (META_WA_PHONE_NUMBER_ID está vacía).`;
}

/** Motivo cuando un DM de Instagram/Messenger llega a una cuenta sin conexión activa. */
export function unknownMetaAccountReason(channel: "INSTAGRAM" | "MESSENGER", accountId: string): string {
  return `${META_LEAD}${channel === "INSTAGRAM" ? "Instagram" : "Messenger"}${META_ACCOUNT}${accountId}, que no tiene una conexión activa en Conexiones.`;
}

export type UnregisteredAccount = {
  channel: "WHATSAPP" | "INSTAGRAM" | "MESSENGER";
  /** Lo que se muestra: el número visible (o su id) en WhatsApp, el id de la cuenta en Meta. */
  account: string;
  /** El id técnico (phone_number_id o el id de la Página / cuenta de IG). */
  accountId: string;
};

const WA_RE = new RegExp(`^${escape(UNREGISTERED_WA_NOTE_PREFIX)}(.+?) \\(id ([^)]+)\\)`);
const META_RE = new RegExp(
  `^${escape(UNREGISTERED_META_NOTE_PREFIX)}(Instagram|Messenger)${escape(META_ACCOUNT)}(.+?), que no tiene una conexión activa`,
);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lee la cuenta o el número de una nota «llegó a una cuenta sin registrar». null si no es una. */
export function parseUnregisteredAccountNote(body: string): UnregisteredAccount | null {
  const wa = WA_RE.exec(body);
  if (wa) return { channel: "WHATSAPP", account: wa[1], accountId: wa[2] };
  const meta = META_RE.exec(body);
  if (meta) {
    return { channel: meta[1] === "Instagram" ? "INSTAGRAM" : "MESSENGER", account: meta[2], accountId: meta[2] };
  }
  return null;
}
