// Consulta de la lista de bloqueados. Se llama en el camino caliente del intake:
// si truena, devuelve false y deja pasar el mensaje — nunca mata la ingesta.
import prisma from "@/lib/db";
import type { MessageChannel } from "@prisma/client";

export async function isSenderBlocked(channel: MessageChannel, identifier: string): Promise<boolean> {
  if (!identifier) return false;
  try {
    const row = await prisma.blockedSender.findUnique({
      where: { channel_identifier: { channel, identifier } },
      select: { unblockedAt: true },
    });
    return !!row && row.unblockedAt === null;
  } catch (err) {
    console.warn(`[moderation] isSenderBlocked falló (${channel}/${identifier}):`, err);
    return false;
  }
}
