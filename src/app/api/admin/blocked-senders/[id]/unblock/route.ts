// Deshace un bloqueo: lo quita en Meta, marca unblockedAt y reactiva el contacto.
// La PII anonimizada NO se recupera — se avisa en la respuesta.
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { canMarkSpam } from "@/lib/moderation/roles";
import { unblockOnMeta } from "@/lib/moderation/meta-moderation";
import { getSocialPageToken } from "@/lib/messaging/social-accounts";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canMarkSpam(session.user.role)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const blocked = await prisma.blockedSender.findUnique({ where: { id: params.id } });
  if (!blocked) return NextResponse.json({ error: "No existe" }, { status: 404 });

  // BlockedSender no guarda connectorId, así que se toma el primer conector activo del
  // canal. Con tres páginas esto puede elegir la equivocada: en ese caso Meta responde que
  // el usuario no existe para esa página, el desbloqueo del CRM se hace igual y el error
  // queda en metaError.
  const connector = await prisma.leadConnector.findFirst({
    where: {
      provider: blocked.channel === "INSTAGRAM" ? "INSTAGRAM" : "MESSENGER",
      status: "ACTIVE",
      deletedAt: null,
    },
  });

  const meta = await unblockOnMeta({
    channel: blocked.channel,
    pageId: connector ? ((connector.config ?? {}) as { pageId?: string }).pageId ?? null : null,
    token: connector ? getSocialPageToken(connector) : null,
    identifier: blocked.identifier,
  });

  await prisma.blockedSender.update({
    where: { id: blocked.id },
    data: { unblockedAt: new Date(), metaError: meta.ok ? null : meta.error ?? null },
  });

  if (blocked.contactId) {
    await prisma.contact.update({
      where: { id: blocked.contactId },
      data: { deletedAt: null, doNotContact: false },
    });
  }

  return NextResponse.json({
    data: {
      meta,
      aviso: "El bloqueo se deshizo. Los datos personales que se borraron al marcar spam no se recuperan.",
    },
  });
}
