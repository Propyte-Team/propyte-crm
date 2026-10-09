import prisma from "@/lib/db";
import type { Conversation, ConversationChannel } from "@prisma/client";
import { resolveBrandForConnector } from "@/lib/brands/resolve";

export interface ConvKey { contactId: string; channel: ConversationChannel; connectorId: string | null }

export function sameConversationKey(a: ConvKey, b: ConvKey): boolean {
  return a.contactId === b.contactId && a.channel === b.channel && (a.connectorId ?? null) === (b.connectorId ?? null);
}

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
 * marca solo se consulta cuando hay un hilo candidato: sin marcas todo queda igual que antes. */
export async function ensureConversation(key: ConvKey): Promise<Conversation> {
  const connectorId = key.connectorId ?? null;
  const where = { contactId: key.contactId, channel: key.channel, connectorId };
  const found = await prisma.conversation.findFirst({ where });
  if (found) return found;

  if (connectorId) {
    const legacy = await prisma.conversation.findFirst({
      where: { contactId: key.contactId, channel: key.channel, connectorId: null },
    });
    if (legacy && (await isDefaultBrandConnector(connectorId))) {
      return prisma.conversation.update({ where: { id: legacy.id }, data: { connectorId } });
    }
  } else {
    // `found` ya buscó el hilo sin conector: si llegamos aquí no existe, y si el más reciente es
    // de otra marca se cae al create de abajo (un hilo sin conector nuevo).
    const recent = await prisma.conversation.findFirst({
      where: { contactId: key.contactId, channel: key.channel },
      orderBy: { lastMessageAt: "desc" },
    });
    if (recent && (recent.connectorId === null || (await isDefaultBrandConnector(recent.connectorId)))) {
      return recent;
    }
  }

  try {
    return await prisma.conversation.create({
      data: { contactId: key.contactId, channel: key.channel, connectorId, status: "BOT", lastMessageAt: new Date() },
    });
  } catch (err) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      const retry = await prisma.conversation.findFirst({ where });
      if (retry) return retry;
    }
    throw err;
  }
}

/** Hilo más reciente del contacto en ese canal (para rutas de cadencia/workflow sin connectorId explícito). */
export async function findConversationForChannel(contactId: string, channel: ConversationChannel): Promise<Conversation | null> {
  return prisma.conversation.findFirst({
    where: { contactId, channel },
    orderBy: { lastMessageAt: "desc" },
  });
}
