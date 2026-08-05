// Reintento manual de una acción FAILED o PENDING. Reusa el texto EXACTO que se
// guardó: reconstruirlo podría mandar otra variante y confundir a quien comentó.
//
// Único endpoint de esta feature con efectos externos reales (publica en el
// post y manda un DM), así que es también el único con candado atómico contra
// el doble reintento y con auditLog.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { getSocialPageToken } from "@/lib/messaging/social-accounts";
import { replyToComment, sendPrivateReply } from "@/lib/comments/graph";
import { persistOpenerForKnownContact } from "@/lib/comments/link-comment-origin";

// Pareado a propósito con el guard de /admin/page.tsx (ADMIN, DIRECTOR,
// GERENTE): la UI de esta feature vive en /admin?tab=comments, así que la API
// no debe conceder más acceso del que esa página deja ver.
const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];

/**
 * FAILED es el caso normal. PENDING también es reintentable: si el worker
 * murió a mitad de la llamada a Graph (timeout, restart, OOM), el log queda en
 * PENDING para siempre — la idempotencia por externalCommentId impide que
 * Meta lo reprocese, así que sin esto un comentario de un cliente real se
 * quedaba mudo y sin forma de repararlo desde la UI.
 *
 * Riesgo asumido: si el proceso original SÍ llegó a llamar a Graph antes de
 * morir (murió justo después, escribiendo el resultado), este reintento no
 * tiene forma de saberlo y puede duplicar el comentario público o el DM. Es
 * un mal menor frente a dejar al cliente sin respuesta para siempre, pero
 * quien lo aprieta debe saberlo.
 */
function isRetryableStatus(status: string): boolean {
  return status === "FAILED" || status === "PENDING";
}

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

  const publicEligible = isRetryableStatus(log.publicReplyStatus) && !!log.publicText;
  const dmEligible = isRetryableStatus(log.dmStatus) && !!log.dmText;
  if (!publicEligible && !dmEligible) {
    return NextResponse.json({ error: "Nada que reintentar en este registro" }, { status: 400 });
  }

  // Pausar el conector es el interruptor de apagado del sistema — igual que
  // resolveConnectorByPageId/ByIgBusinessId, que sí filtran por ACTIVE. Sin
  // este filtro, pausar la cuenta (p. ej. porque un cliente se quejó o la
  // cuenta está comprometida) no evitaba que el reintento publicara igual.
  const connector = await prisma.leadConnector.findFirst({
    where: { id: log.connectorId, deletedAt: null, status: "ACTIVE" },
  });
  if (!connector) {
    return NextResponse.json(
      { error: "El conector está pausado o no disponible: no se puede reintentar" },
      { status: 400 }
    );
  }

  // getSocialPageToken (vía readCredentials) necesita el conector COMPLETO: el
  // blob `credentials` cifrado es justo el campo que hay que descifrar para el
  // token, así que un `select` aquí no ahorraría nada real.
  const token = getSocialPageToken(connector);
  if (!token) {
    return NextResponse.json({ error: "Conector sin pageAccessToken" }, { status: 400 });
  }

  // Candado atómico sin transacción, mismo patrón que persistOpenerForKnownContact
  // / linkCommentOrigin en link-comment-origin.ts: reclama cada acción
  // condicionando el `where` al estado que justificó el reintento y
  // moviéndola a PENDING. Dos clicks casi simultáneos (o dos pestañas) que
  // lean el mismo log FAILED solo pueden "ganar" uno: el segundo update ya no
  // encuentra el estado FAILED y su `count` sale en 0. Independientes a
  // propósito: la pública puede estar FAILED mientras el DM ya está SENT (o
  // al revés), así que se reclaman por separado.
  let claimedPublic = false;
  if (publicEligible) {
    const claim = await prisma.commentRuleLog.updateMany({
      where: { id: log.id, publicReplyStatus: log.publicReplyStatus },
      data: { publicReplyStatus: "PENDING" },
    });
    claimedPublic = claim.count === 1;
  }

  let claimedDm = false;
  if (dmEligible) {
    const claim = await prisma.commentRuleLog.updateMany({
      where: { id: log.id, dmStatus: log.dmStatus },
      data: { dmStatus: "PENDING" },
    });
    claimedDm = claim.count === 1;
  }

  if (!claimedPublic && !claimedDm) {
    return NextResponse.json(
      { error: "Otro reintento ya está procesando este registro" },
      { status: 409 }
    );
  }

  const data: Record<string, unknown> = {};

  if (claimedPublic && log.publicText) {
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
      // Se reclamó poniéndolo en PENDING: si Graph falla hay que devolverlo a
      // FAILED explícitamente, o el log quedaría PENDING para siempre (y
      // desaparecería del filtro "solo fallidos" de la UI).
      data.publicReplyStatus = "FAILED";
      data.publicReplyError = errorText(err);
    }
  }

  if (claimedDm && log.dmText) {
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
      data.dmStatus = "FAILED";
      data.dmError = errorText(err);
    }
  }

  const updated = await prisma.commentRuleLog.update({ where: { id: log.id }, data });

  // Única acción de esta superficie con efectos externos reales: se audita
  // qué acción se reintentó y con qué resultado.
  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: "UPDATE",
        entity: "CommentRuleLog",
        entityId: log.id,
        changes: {
          publicReply: claimedPublic
            ? {
                resumedFromPending: log.publicReplyStatus === "PENDING",
                status: data.publicReplyStatus,
                error: data.publicReplyError ?? null,
              }
            : null,
          dm: claimedDm
            ? {
                resumedFromPending: log.dmStatus === "PENDING",
                status: data.dmStatus,
                error: data.dmError ?? null,
              }
            : null,
        } as object,
      },
    })
    .catch(() => {});

  return NextResponse.json({ data: updated });
}
