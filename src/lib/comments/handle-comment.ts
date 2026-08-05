// Orquestación de un comentario entrante: descartes → idempotencia → match →
// cuota → log → respuesta pública y DM privado (independientes entre sí).
import prisma from "@/lib/db";
import type { IncomingComment } from "./parse";
import { matchRule } from "./match";
import { renderTemplate, pickVariant } from "./template";
import { replyToComment, sendPrivateReply } from "./graph";
import {
  resolveConnectorByIgBusinessId,
  resolveConnectorByPageId,
  getSocialPageToken,
} from "@/lib/messaging/social-accounts";

export type CommentOutcome =
  | "sin-conector"
  | "propio"
  | "anidado"
  | "duplicado"
  | "sin-match"
  | "cuota"
  | "sin-token"
  | "procesado";

export interface HandleCommentResult {
  status: CommentOutcome;
  logId?: string;
}

const ERROR_MAX = 500;

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX);
}

export async function handleComment(comment: IncomingComment): Promise<HandleCommentResult> {
  const connector =
    comment.platform === "INSTAGRAM"
      ? await resolveConnectorByIgBusinessId(comment.accountId)
      : await resolveConnectorByPageId(comment.accountId);

  if (!connector) {
    console.warn(
      `[comments] sin conector activo para ${comment.platform} accountId=${comment.accountId}`
    );
    return { status: "sin-conector" };
  }

  // Anti-loop: nuestra propia respuesta pública vuelve como comentario nuevo.
  const config = (connector.config ?? {}) as { pageId?: string; igBusinessId?: string };
  if (comment.authorId === config.igBusinessId || comment.authorId === config.pageId) {
    return { status: "propio" };
  }

  // Instagram no acepta responder a una respuesta: solo primer nivel.
  if (comment.isNested) return { status: "anidado" };

  const existing = await prisma.commentRuleLog.findUnique({
    where: { externalCommentId: comment.externalCommentId },
  });
  if (existing) return { status: "duplicado", logId: existing.id };

  const rules = await prisma.commentRule.findMany({
    where: { connectorId: connector.id, isActive: true, deletedAt: null },
  });
  const match = matchRule(rules, comment.text, comment.postId);
  if (!match) return { status: "sin-match" };

  const vars = { usuario: comment.authorHandle };
  const dmText = renderTemplate(match.rule.dmTemplate, vars);

  const base = {
    ruleId: match.rule.id,
    connectorId: connector.id,
    platform: comment.platform,
    externalCommentId: comment.externalCommentId,
    postId: comment.postId,
    authorId: comment.authorId,
    authorHandle: comment.authorHandle,
    commentText: comment.text.slice(0, 2000),
    matchedPhrase: match.phrase,
  };

  // Cuota: una respuesta por persona por publicación.
  const previous = await prisma.commentRuleLog.findFirst({
    where: { connectorId: connector.id, postId: comment.postId, authorId: comment.authorId },
  });
  if (previous) {
    const log = await prisma.commentRuleLog.create({
      data: { ...base, publicReplyStatus: "SKIPPED", dmStatus: "SKIPPED" },
    });
    return { status: "cuota", logId: log.id };
  }

  const token = getSocialPageToken(connector);
  if (!token) {
    const log = await prisma.commentRuleLog.create({
      data: {
        ...base,
        publicReplyStatus: "FAILED",
        publicReplyError: "Conector sin pageAccessToken",
        dmStatus: "FAILED",
        dmError: "Conector sin pageAccessToken",
        dmText,
      },
    });
    return { status: "sin-token", logId: log.id };
  }

  // Rotación: cuántas veces ya salió esta regla en público.
  const fired = await prisma.commentRuleLog.count({
    where: { ruleId: match.rule.id, publicReplyStatus: "SENT" },
  });
  const publicText = renderTemplate(pickVariant(match.rule.publicReplies, fired) ?? "", vars);

  // El log se crea ANTES de Graph: el índice único de externalCommentId es el
  // candado contra los reintentos concurrentes del webhook de Meta.
  const log = await prisma.commentRuleLog.create({
    data: {
      ...base,
      publicReplyStatus: "PENDING",
      dmStatus: "PENDING",
      publicText,
      dmText,
    },
  });

  if (publicText) {
    // Fix 1 (code review, Task 6): la llamada a Graph y el update que la
    // registra viven en tries separados. Si Graph falla, FAILED es correcto
    // (comportamiento sin cambios, catch de abajo). Pero si Graph tiene éxito
    // y es el update el que revienta (blip de la base), NO se puede escribir
    // FAILED — el comentario YA está respondido en público; marcarlo FAILED
    // sería mentir. Se deja el log sin actualizar y se avisa fuerte por
    // consola con los IDs necesarios para reconciliar a mano.
    let reply: { id: string } | undefined;
    try {
      reply = await replyToComment(
        comment.platform,
        token,
        comment.externalCommentId,
        publicText
      );
    } catch (err) {
      console.error("[comments] respuesta pública falló:", err);
      await prisma.commentRuleLog.update({
        where: { id: log.id },
        data: { publicReplyStatus: "FAILED", publicReplyError: errorText(err) },
      });
    }
    if (reply) {
      try {
        await prisma.commentRuleLog.update({
          where: { id: log.id },
          data: { publicReplyStatus: "SENT", publicReplyId: reply.id },
        });
      } catch (err) {
        console.error(
          `[comments] ALERTA reconciliación manual: respuesta pública SÍ salió (logId=${log.id}, publicReplyId=${reply.id}) pero no se pudo marcar SENT en el log:`,
          err
        );
      }
    }
  } else {
    // Sin esto, un publicReplies vacío (pickVariant devuelve null → publicText
    // "") dejaba el log en PENDING para siempre: ninguna ruta lo actualizaba,
    // así que quedaba invisible en la UI, ni enviado ni fallido. La validación
    // de reglas exige al menos una variante, así que no debería pasar — pero
    // un estado terminal imposible de alcanzar es una trampa.
    await prisma.commentRuleLog.update({
      where: { id: log.id },
      data: {
        publicReplyStatus: "SKIPPED",
        publicReplyError: "La regla no tenía respuesta pública configurada (publicReplies vacío)",
      },
    });
  }

  try {
    const dm = await sendPrivateReply(token, comment.externalCommentId, dmText);

    // Fix 1 (code review, Task 6): mismo criterio que la respuesta pública,
    // pero aquí es más grave. Si el DM sale y el update de dmStatus/
    // dmExternalMessageId falla, NO se marca FAILED (mentiría: el DM ya está
    // en el chat del cliente). Y sin dmExternalMessageId persistido, el guard
    // que handleEchoMessage usa para no aplicar el takeover (busca el log por
    // dmExternalMessageId) no encuentra nada, cae al camino viejo, registra
    // el eco como ADVISOR y enmudece al bot — la carrera que ya se cerró.
    try {
      await prisma.commentRuleLog.update({
        where: { id: log.id },
        data: {
          dmStatus: "SENT",
          dmRecipientId: dm.recipientId,
          dmExternalMessageId: dm.messageId,
        },
      });
    } catch (err) {
      console.error(
        `[comments] ALERTA reconciliación manual: DM SÍ salió (logId=${log.id}, dmExternalMessageId=${dm.messageId}, dmRecipientId=${dm.recipientId ?? "null"}) pero no se pudo marcar SENT en el log:`,
        err
      );
    }

    // Si ya es contacto, el opener se persiste en su hilo AHORA. Si no se hace,
    // el eco del propio DM entra como ADVISOR y dispara el takeover que
    // enmudece al bot (lib/messaging/core.ts, handleEchoMessage). Se intenta
    // aunque el update de arriba haya fallado: son defensas independientes,
    // que falle una escritura no debe arrastrar a la otra.
    if (dm.recipientId) {
      try {
        const { persistOpenerForKnownContact } = await import("./link-comment-origin");
        await persistOpenerForKnownContact({
          platform: comment.platform,
          connectorId: connector.id,
          recipientId: dm.recipientId,
          text: dmText,
          externalMessageId: dm.messageId,
        });
      } catch (err) {
        console.error("[comments] persistOpenerForKnownContact falló:", err);
      }
    }
  } catch (err) {
    console.error("[comments] private reply falló:", err);
    await prisma.commentRuleLog.update({
      where: { id: log.id },
      data: { dmStatus: "FAILED", dmError: errorText(err) },
    });
  }

  return { status: "procesado", logId: log.id };
}
