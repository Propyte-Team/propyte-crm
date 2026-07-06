import prisma from "@/lib/db";
import type { Conversation, ConversationChannel } from "@prisma/client";

export interface ConvKey { contactId: string; channel: ConversationChannel; connectorId: string | null }

export function sameConversationKey(a: ConvKey, b: ConvKey): boolean {
  return a.contactId === b.contactId && a.channel === b.channel && (a.connectorId ?? null) === (b.connectorId ?? null);
}

/** Devuelve la conversación del (contacto, canal, connector); la crea si no existe. Maneja carrera P2002. */
export async function ensureConversation(key: ConvKey): Promise<Conversation> {
  const connectorId = key.connectorId ?? null;
  const where = { contactId: key.contactId, channel: key.channel, connectorId };
  const found = await prisma.conversation.findFirst({ where });
  if (found) return found;
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
