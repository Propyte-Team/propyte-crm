import prisma from "@/lib/db";
import type { Conversation, ConversationChannel } from "@prisma/client";
import { resolveBrandForConnector } from "@/lib/brands/resolve";

export interface ConvKey { contactId: string; channel: ConversationChannel; connectorId: string | null }

export function sameConversationKey(a: ConvKey, b: ConvKey): boolean {
  return a.contactId === b.contactId && a.channel === b.channel && (a.connectorId ?? null) === (b.connectorId ?? null);
}

/**
 * Línea de WhatsApp de un asesor (2026-10-14, coexistencia PR 2): su `ownerUserId`, o null si la
 * cuenta es una línea de marca (o no se pudo leer — en ese caso el hilo nace como siempre; el bot
 * tiene su propio candado, que falla cerrado, en bot-respond.ts).
 */
async function advisorLineOf(connectorId: string): Promise<{ ownerUserId: string | null } | null> {
  try {
    const c = await prisma.leadConnector.findUnique({ where: { id: connectorId }, select: { scope: true, ownerUserId: true } });
    return c?.scope === "ADVISOR" ? { ownerUserId: c.ownerUserId ?? null } : null;
  } catch (err) {
    console.error("[conversations] no se pudo leer el alcance de la cuenta", connectorId, (err as { code?: string } | null)?.code ?? "");
    return null;
  }
}

/** Hilos que NO son de un número de asesor: sin cuenta, o de una cuenta de marca. */
const NOT_ADVISOR_THREAD = { OR: [{ connectorId: null }, { connector: { scope: "BRAND" as const } }] };

/** ¿La cuenta es de la marca predeterminada? Sin cuenta, sin marca o con la predeterminada → sí.
 *  Una marca no predeterminada o "no disponible" (no se puede leer) → no: falla cerrado. */
async function isDefaultBrandConnector(connectorId: string | null): Promise<boolean> {
  return (await resolveBrandForConnector(connectorId)).kind === "default";
}

/** Devuelve la conversación del (contacto, canal, connector); la crea si no existe. Maneja carrera P2002.
 * Adopción (cuenta WA en el Inbox, 2026-07-25): al empezar a resolver connectorId en un canal,
 * el hilo previo sin conector se ADOPTA (update) en vez de partir la conversación en dos; y una
 * key sin conector reusa el hilo más reciente del canal en vez de crear uno paralelo.
 *
 * Marcas del agente (2026-10-09, spec marcas-agente §1, §2.3): la adopción y la reutilización
 * NO cruzan marcas. Un hilo sin conector es del número global (marca predeterminada), así que solo
 * lo adopta una cuenta de la predeterminada; una cuenta de otra marca (o cuya marca no se puede
 * leer) abre su propio hilo — si no, lo hablado con Propyte se reetiquetaría como de la otra marca
 * y le llegaría a su agente como historial. Igual al revés: una key sin conector solo reusa el hilo
 * más reciente si es sin conector o de la predeterminada; si no, abre un hilo sin conector. La
 * marca solo se consulta cuando hay un hilo candidato: sin marcas todo queda igual que antes.
 *
 * Números de asesor (2026-10-14, coexistencia PR 2): el número propio de un asesor es OTRA línea,
 * no un hilo más de la marca. Una cuenta de asesor nunca adopta el hilo sin cuenta (es el del
 * número global), y una clave sin cuenta nunca reutiliza un hilo de asesor (lo mandado «sin
 * cuenta» sale por el número global y no debe aparecer en el chat personal del asesor). Su hilo
 * nace en manos del asesor (HUMAN, `controlledById` = dueño) y con el bot apagado: en esa línea
 * solo contesta él (decisión 2 del dueño). */
export async function ensureConversation(key: ConvKey): Promise<Conversation> {
  const connectorId = key.connectorId ?? null;
  const where = { contactId: key.contactId, channel: key.channel, connectorId };
  const found = await prisma.conversation.findFirst({ where });
  if (found) return found;

  let advisor: { ownerUserId: string | null } | null = null;
  if (connectorId) {
    advisor = key.channel === "WHATSAPP" ? await advisorLineOf(connectorId) : null;
    if (!advisor) {
      const legacy = await prisma.conversation.findFirst({
        where: { contactId: key.contactId, channel: key.channel, connectorId: null },
      });
      if (legacy && (await isDefaultBrandConnector(connectorId))) {
        return prisma.conversation.update({ where: { id: legacy.id }, data: { connectorId } });
      }
    }
  } else {
    // `found` ya buscó el hilo sin conector: si llegamos aquí no existe, y si el más reciente es
    // de otra marca (o de un asesor) se cae al create de abajo (un hilo sin conector nuevo).
    const recent = await prisma.conversation.findFirst({
      where: { contactId: key.contactId, channel: key.channel, ...(key.channel === "WHATSAPP" ? NOT_ADVISOR_THREAD : {}) },
      orderBy: { lastMessageAt: "desc" },
    });
    if (recent && (recent.connectorId === null || (await isDefaultBrandConnector(recent.connectorId)))) {
      return recent;
    }
  }

  const now = new Date();
  try {
    return await prisma.conversation.create({
      data: advisor
        ? {
            contactId: key.contactId,
            channel: key.channel,
            connectorId,
            status: "HUMAN",
            botEnabled: false,
            controlledById: advisor.ownerUserId,
            takeoverAt: now,
            lastMessageAt: now,
          }
        : { contactId: key.contactId, channel: key.channel, connectorId, status: "BOT", lastMessageAt: now },
    });
  } catch (err) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      const retry = await prisma.conversation.findFirst({ where });
      if (retry) return retry;
    }
    throw err;
  }
}

/**
 * Hilo más reciente del contacto en ese canal (para rutas de cadencia/workflow sin connectorId explícito).
 *
 * En WhatsApp ignora los hilos de números de asesor (2026-10-14): de aquí sacan la línea de envío
 * los workflows, los agentes y las acciones de IA, y nada automático sale por el WhatsApp propio de
 * un asesor (decisión 2 del dueño). Con un contacto que solo habla con el asesor, devuelve null y
 * lo automático sale por el número global, como cualquier contacto sin hilo.
 */
export async function findConversationForChannel(contactId: string, channel: ConversationChannel): Promise<Conversation | null> {
  return prisma.conversation.findFirst({
    where: { contactId, channel, ...(channel === "WHATSAPP" ? NOT_ADVISOR_THREAD : {}) },
    orderBy: { lastMessageAt: "desc" },
  });
}
