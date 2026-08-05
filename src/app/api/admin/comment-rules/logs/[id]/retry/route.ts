// Reintento manual de una acción FAILED. Reusa el texto EXACTO que se guardó:
// reconstruirlo podría mandar otra variante y confundir a quien comentó.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { getSocialPageToken } from "@/lib/messaging/social-accounts";
import { replyToComment, sendPrivateReply } from "@/lib/comments/graph";
import { persistOpenerForKnownContact } from "@/lib/comments/link-comment-origin";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const log = await prisma.commentRuleLog.findUnique({ where: { id: params.id } });
  if (!log) return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
  if (log.publicReplyStatus !== "FAILED" && log.dmStatus !== "FAILED") {
    return NextResponse.json({ error: "Nada que reintentar en este registro" }, { status: 400 });
  }

  const connector = await prisma.leadConnector.findFirst({
    where: { id: log.connectorId, deletedAt: null },
  });
  if (!connector) return NextResponse.json({ error: "Conector no disponible" }, { status: 400 });

  const token = getSocialPageToken(connector);
  if (!token) {
    return NextResponse.json({ error: "Conector sin pageAccessToken" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if (log.publicReplyStatus === "FAILED" && log.publicText) {
    try {
      const reply = await replyToComment(
        log.platform,
        token,
        log.externalCommentId,
        log.publicText
      );
      data.publicReplyStatus = "SENT";
      data.publicReplyId = reply.id;
      data.publicReplyError = null;
    } catch (err) {
      data.publicReplyError = errorText(err);
    }
  }

  if (log.dmStatus === "FAILED" && log.dmText) {
    try {
      const dm = await sendPrivateReply(token, log.externalCommentId, log.dmText);
      data.dmStatus = "SENT";
      data.dmRecipientId = dm.recipientId;
      data.dmExternalMessageId = dm.messageId;
      data.dmError = null;
      if (dm.recipientId) {
        await persistOpenerForKnownContact({
          platform: log.platform,
          connectorId: log.connectorId,
          recipientId: dm.recipientId,
          text: log.dmText,
          externalMessageId: dm.messageId,
        }).catch((err) => console.error("[comments] opener en reintento:", err));
      }
    } catch (err) {
      data.dmError = errorText(err);
    }
  }

  const updated = await prisma.commentRuleLog.update({ where: { id: log.id }, data });
  return NextResponse.json({ data: updated });
}
