// Reintenta el bloqueo en Meta de un BlockedSender que quedó FAILED.
// Mismo patrón que /api/admin/comment-rules/logs/[id]/retry.
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { canMarkSpam } from "@/lib/moderation/roles";
import { blockOnMeta } from "@/lib/moderation/meta-moderation";
import { recordMetaResult } from "@/lib/moderation/block-sender";
import { getSocialPageToken } from "@/lib/messaging/social-accounts";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canMarkSpam(session.user.role)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const blocked = await prisma.blockedSender.findUnique({ where: { id: params.id } });
  if (!blocked) return NextResponse.json({ error: "No existe" }, { status: 404 });
  if (blocked.unblockedAt) {
    return NextResponse.json({ error: "Este remitente ya está desbloqueado" }, { status: 409 });
  }

  // Misma limitación que en la ruta de desbloqueo: BlockedSender no guarda connectorId.
  const connector = await prisma.leadConnector.findFirst({
    where: {
      provider: blocked.channel === "INSTAGRAM" ? "INSTAGRAM" : "MESSENGER",
      status: "ACTIVE",
      deletedAt: null,
    },
  });

  const meta = await blockOnMeta({
    channel: blocked.channel,
    pageId: connector ? ((connector.config ?? {}) as { pageId?: string }).pageId ?? null : null,
    token: connector ? getSocialPageToken(connector) : null,
    identifier: blocked.identifier,
  });
  await recordMetaResult(blocked.id, meta);

  return NextResponse.json({ data: { meta } });
}
