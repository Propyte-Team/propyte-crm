// Rastro visible cuando Meta rechaza la respuesta del bot (2026-10-10).
//
// Por qué existe: un DM a @propytemx se quedó sin respuesta del bot porque Meta
// rechazó el envío — la bandeja de Meta Business Suite era la dueña del hilo
// (ruteo de conversaciones). El error moría en un console.error de quien llamó
// a botRespond: el mensaje del cliente se veía en el Inbox, la respuesta no, y
// ni el equipo ni el monitoreo podían saber por qué el bot se quedó callado.
//
// Ahora el rechazo se guarda como nota interna en la conversación (la misma
// marca `internalNote` de las notas del asesor): el Inbox la pinta como nota y
// nunca se le manda al cliente. El bot, el resumen de escalamiento y el guard
// anti-ráfaga filtran `internalNote: false`, así que la nota no les cambia nada.
//
// Silencios del agente (2026-10-12): dos WhatsApp al número general se quedaron sin
// respuesta y sin rastro —ni saliente, ni nota, conversación en BOT, canal activo, contacto
// sin baja— y sin acceso a los registros del servidor no había forma de saber por qué. El
// mismo rastro sirve para eso: `recordBotSilence` deja la nota cuando el agente decide NO
// contestar por algo que está mal o mal configurado (no por un silencio normal, como el
// interruptor maestro apagado o un humano al mando). Prefijo propio para que el monitoreo
// pueda buscar los dos tipos por separado; mismo deduplicado y mismo «nunca lanza».
import prisma from "@/lib/db";
import type { MessagingChannel } from "./types";
import { GraphSendError } from "./graph";
import { BOT_SEND_REJECTED_PREFIX, BOT_SILENCE_PREFIX } from "./bot-note-prefix";

// Los prefijos viven en ./bot-note-prefix (sin dependencias) y se siguen exportando desde aquí.
export { BOT_SEND_REJECTED_PREFIX, BOT_SILENCE_PREFIX };

// "Otra app es la dueña del hilo". El código exacto que manda Instagram no está
// documentado de forma fiable (y Messenger usa otro), así que se reconoce por el
// texto de Meta, que siempre habla del dueño del hilo o de otra app.
const THREAD_OWNER_RE =
  /thread[ _-]?owner|owner of (?:this|the) thread|another app|pass_thread_control|handover|conversation routing/i;

// Fuera de la ventana de 24 h: también llega con code 10, pero no es un problema
// de permisos y decirlo así mandaría a revisar lo que no es. Subcódigos de la
// Send API de Messenger (2018278) y de Instagram (2534022).
const WINDOW_SUBCODES = new Set([2018278, 2534022]);
const WINDOW_RE = /outside (?:of )?(?:the )?allowed window/i;

const PERMISSION_RE = /pages_messaging|instagram_manage_messages/i;

// WhatsApp (2026-10-12): su transporte (lib/whatsapp/transport.ts) no lanza GraphSendError
// sino Error con el código de Meta en el texto. Estos son los rechazos de la Cloud API —
// el resto (sin teléfono, cuenta sin credenciales…) falló antes de llegar a Meta.
const WHATSAPP_REJECTED_RE = /^(?:Meta Cloud API \d+:|Fuera de la ventana de 24h de WhatsApp|WhatsApp \(\d+\):)/;

const RAW_MAX = 500;
const REASON_MAX = 600;
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Tapa lo que parezca un secreto: el token de Graph en una URL, una cabecera Bearer o una
 * llave de la API de Anthropic. La nota la lee cualquiera con acceso al Inbox.
 */
function hideSecrets(text: string): string {
  return text
    .replace(/access_token=[^&\s"]+/gi, "access_token=[oculto]")
    .replace(/Bearer\s+[^\s"]+/gi, "Bearer [oculto]")
    .replace(/sk-ant-[\w-]+/g, "[oculto]");
}

/** El texto crudo del error, recortado y sin nada que parezca un token. */
function rawError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return hideSecrets(text).slice(0, RAW_MAX);
}

/**
 * Texto en español para la nota interna. Puro: decide solo con el error.
 * Los rechazos que se reconocen llevan además el detalle textual de Meta, para
 * que quien revise no dependa de que esta clasificación haya acertado.
 */
export function describeBotSendFailure(err: unknown): string {
  const raw = rawError(err);
  if (!(err instanceof GraphSendError)) {
    // WhatsApp: Meta sí recibió el envío y lo rechazó; el texto del transporte ya trae
    // el código y el detalle de Meta (y la explicación de la ventana de 24 h).
    if (WHATSAPP_REJECTED_RE.test(raw)) return `${BOT_SEND_REJECTED_PREFIX}: ${raw}`;
    // Falló antes de llegar a Meta (contacto sin id del canal, cuenta inactiva,
    // sin token…). También deja al bot callado, así que también se ve.
    return `No se pudo enviar la respuesta del bot: ${raw}`;
  }
  const meta = err.graphMessage ?? "";
  const detail = `\nDetalle de Meta: ${raw}`;
  if (THREAD_OWNER_RE.test(meta)) {
    return (
      `${BOT_SEND_REJECTED_PREFIX}: otra app tiene el control de esta conversación (ruteo de conversaciones). ` +
      "Mientras la bandeja de Meta Business Suite sea la dueña del hilo, el bot no puede contestar desde el CRM." +
      detail
    );
  }
  if ((err.subcode !== null && WINDOW_SUBCODES.has(err.subcode)) || WINDOW_RE.test(meta)) {
    return (
      `${BOT_SEND_REJECTED_PREFIX}: pasaron más de 24 h desde el último mensaje del cliente ` +
      "y Meta ya no permite contestarle por este canal." +
      detail
    );
  }
  if (err.code === 10 || PERMISSION_RE.test(meta)) {
    return (
      `${BOT_SEND_REJECTED_PREFIX}: la app del CRM no tiene permiso para enviar mensajes desde esta cuenta ` +
      "(pages_messaging / instagram_manage_messages). Hay que revisar los permisos del token de la cuenta en Conexiones." +
      detail
    );
  }
  return `${BOT_SEND_REJECTED_PREFIX}: ${raw}`;
}

/**
 * Un error de la base no dice si el mensaje salió: sendChannelMessage escribe
 * el Message DESPUÉS de mandarlo, así que un fallo ahí llega con la respuesta
 * ya en el chat del cliente. Una nota "no se pudo enviar" sería mentira.
 */
function isDatabaseError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === "string" && name.startsWith("PrismaClient");
}

/**
 * Escribe la nota interna en la conversación. Nunca lanza: quien llama ya tiene
 * su propio error que propagar (o su propio `return`), y este rastro no puede taparlo.
 *
 * Si la conversación ya tiene la misma nota de las últimas 24 h no se repite:
 * con el hilo en manos de otra app el bot falla con CADA mensaje del cliente,
 * y una nota idéntica por mensaje taparía la conversación sin decir nada nuevo.
 * Lo mismo con un silencio por configuración (canal apagado, número sin dar de
 * alta): se repite con cada mensaje hasta que alguien lo corrija.
 */
async function writeBotNote(args: {
  contactId: string;
  conversationId: string;
  channel: MessagingChannel;
  body: string;
}): Promise<void> {
  try {
    const repeated = await prisma.message.findFirst({
      where: {
        conversationId: args.conversationId,
        internalNote: true,
        sender: "SYSTEM",
        body: args.body,
        createdAt: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (repeated) return;
    await prisma.message.create({
      data: {
        contactId: args.contactId,
        conversationId: args.conversationId,
        channel: args.channel,
        direction: "OUTBOUND",
        body: args.body,
        // FAILED: es la huella de una respuesta que no salió. La ficha del
        // contacto (conversation-panel) muestra el estado de los salientes.
        status: "FAILED",
        sender: "SYSTEM",
        internalNote: true,
      },
    });
  } catch (err) {
    console.error(
      `[bot] no se pudo registrar la nota del bot (conversación ${args.conversationId}):`,
      rawError(err)
    );
  }
}

/** Deja la nota de un envío del bot que falló (ver describeBotSendFailure). Nunca lanza. */
export async function recordBotSendFailure(args: {
  contactId: string;
  conversationId: string;
  channel: MessagingChannel;
  err: unknown;
}): Promise<void> {
  if (isDatabaseError(args.err)) return;
  await writeBotNote({ ...args, body: describeBotSendFailure(args.err) });
}

/**
 * Deja la nota «El agente no contestó: {motivo}» (2026-10-12). Nunca lanza.
 *
 * Solo para los silencios que delatan algo mal o mal configurado; los normales (master
 * switch apagado, contacto dado de baja, humano al mando, ráfaga que contesta otro
 * disparo) no pasan por aquí. `conversationId` null = el silencio ocurrió antes de que
 * hubiera un hilo donde escribir: queda solo el console.warn, que se deja SIEMPRE.
 */
export async function recordBotSilence(args: {
  contactId: string;
  conversationId: string | null | undefined;
  channel: MessagingChannel;
  reason: string;
}): Promise<void> {
  const body = `${BOT_SILENCE_PREFIX}: ${hideSecrets(args.reason).slice(0, REASON_MAX)}`;
  console.warn(`[bot] ${body}`, { contactId: args.contactId, conversationId: args.conversationId ?? null });
  if (!args.conversationId) return;
  await writeBotNote({
    contactId: args.contactId,
    conversationId: args.conversationId,
    channel: args.channel,
    body,
  });
}
