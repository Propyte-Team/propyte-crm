// Llamadas a Graph para comentarios. El token va en el body y no en el query
// string: los errores de fetch acaban en logs y una URL con token es una fuga.

const GRAPH = "https://graph.facebook.com/v24.0";

interface GraphError {
  error?: { code?: number; message?: string };
}

async function postJson(url: string, payload: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & GraphError;
  return { __ok: res.ok, __status: res.status, ...data };
}

function graphError(prefix: string, data: Record<string, unknown>): Error {
  const err = (data.error ?? {}) as { code?: number; message?: string };
  return new Error(`${prefix} ${err.code ?? data.__status}: ${err.message ?? "error"}`);
}

/**
 * Respuesta pública al comentario.
 * Instagram: POST /{ig-comment-id}/replies · Facebook: POST /{comment-id}/comments
 */
export async function replyToComment(
  platform: "INSTAGRAM" | "FACEBOOK",
  pageToken: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  const edge = platform === "INSTAGRAM" ? "replies" : "comments";
  const data = await postJson(`${GRAPH}/${commentId}/${edge}`, {
    message,
    access_token: pageToken,
  });
  if (!data.__ok || data.error) throw graphError("Comment reply", data);
  const id = typeof data.id === "string" ? data.id : null;
  if (!id) throw new Error("Comment reply sin id en la respuesta de Graph");
  return { id };
}

/**
 * Private reply: único camino que Meta ofrece para escribirle a alguien que
 * solo comentó. Una vez por comentario y dentro de la ventana de 7 días.
 * El `recipient_id` que regresa es el PSID (Facebook) o IGSID (Instagram).
 */
export async function sendPrivateReply(
  pageToken: string,
  commentId: string,
  text: string
): Promise<{ messageId: string; recipientId: string | null }> {
  const data = await postJson(`${GRAPH}/me/messages`, {
    recipient: { comment_id: commentId },
    message: { text },
    access_token: pageToken,
  });
  if (!data.__ok || data.error) throw graphError("Private reply", data);
  const messageId = typeof data.message_id === "string" ? data.message_id : null;
  if (!messageId) throw new Error("Private reply sin message_id en la respuesta de Graph");
  return {
    messageId,
    recipientId: typeof data.recipient_id === "string" ? data.recipient_id : null,
  };
}
