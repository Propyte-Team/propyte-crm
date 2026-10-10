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
import prisma from "@/lib/db";
import type { MessagingChannel } from "./types";
import { GraphSendError } from "./graph";

/** Inicio fijo de las notas de rechazo de Meta: sirve para buscarlas. */
export const BOT_SEND_REJECTED_PREFIX = "Meta rechazó la respuesta del bot";

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

const RAW_MAX = 500;
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** El texto crudo del error, recortado y sin nada que parezca un token. */
function rawError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/access_token=[^&\s"]+/gi, "access_token=[oculto]").slice(0, RAW_MAX);
}

/**
 * Texto en español para la nota interna. Puro: decide solo con el error.
 * Los rechazos que se reconocen llevan además el detalle textual de Meta, para
 * que quien revise no dependa de que esta clasificación haya acertado.
 */
export function describeBotSendFailure(err: unknown): string {
  const raw = rawError(err);
  if (!(err instanceof GraphSendError)) {
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
 * Deja la nota interna en la conversación. Nunca lanza: quien llama ya tiene
 * su propio error que propagar, y este rastro no puede taparlo.
 *
 * Si la conversación ya tiene la misma nota de las últimas 24 h no se repite:
 * con el hilo en manos de otra app el bot falla con CADA mensaje del cliente,
 * y una nota idéntica por mensaje taparía la conversación sin decir nada nuevo.
 */
export async function recordBotSendFailure(args: {
  contactId: string;
  conversationId: string;
  channel: MessagingChannel;
  err: unknown;
}): Promise<void> {
  if (isDatabaseError(args.err)) return;
  const body = describeBotSendFailure(args.err);
  try {
    const repeated = await prisma.message.findFirst({
      where: {
        conversationId: args.conversationId,
        internalNote: true,
        sender: "SYSTEM",
        body,
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
        body,
        // FAILED: es la huella de una respuesta que no salió. La ficha del
        // contacto (conversation-panel) muestra el estado de los salientes.
        status: "FAILED",
        sender: "SYSTEM",
        internalNote: true,
      },
    });
  } catch (err) {
    console.error(
      `[bot] no se pudo registrar el rechazo del envío (conversación ${args.conversationId}):`,
      rawError(err)
    );
  }
}
