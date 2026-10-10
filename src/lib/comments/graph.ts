// Llamadas a Graph para comentarios. El token va en el body (POST) o en la
// cabecera Authorization (GET), nunca en el query string: los errores de fetch
// acaban en logs y una URL con token es una fuga.

const GRAPH = "https://graph.facebook.com/v24.0";

// Dos llamadas secuenciales (respuesta pública + private reply) más escrituras
// de log caben en el maxDuration de 30s del webhook; 8s por llamada deja margen
// para ambas sin arriesgar que un cuelgue de Graph deje el registro en PENDING.
const TIMEOUT_MS = 8000;

// Verificación tras un timeout (2026-10-10). En producción la respuesta pública
// a un comentario de Instagram se cortó a los 8 s ("The operation was aborted
// due to timeout") y un reintento volvió a fallar igual: Meta puede tardar más
// que nuestro timeout y publicar de todos modos, así que "timeout" NO significa
// "no se publicó". Antes de declarar FAILED se esperan 1.5 s y se leen las
// respuestas del comentario.
//
// Presupuesto del webhook (maxDuration 30 s), peor caso: POST 8 s + espera
// 1.5 s + lectura 5 s + private reply 8 s = 22.5 s, y quedan ~7 s para las
// escrituras del log y el alta del contacto. Por eso TIMEOUT_MS se queda en 8 s:
// subirlo a 10 s dejaría ~5 s de margen, y con la verificación ya no hace falta
// esperar más — si Meta publica tarde, la lectura lo encuentra; si publica
// todavía más tarde, el reintento manual también verifica antes de publicar.
const VERIFY_DELAY_MS = 1500;
const VERIFY_TIMEOUT_MS = 5000;

async function postJson(
  url: string,
  payload: unknown
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

function graphError(prefix: string, status: number, data: Record<string, unknown>): Error {
  if (typeof data.error === "string") return new Error(`${prefix} ${status}: ${data.error}`);
  const err = (data.error ?? {}) as { code?: number; message?: string };
  return new Error(`${prefix} ${err.code ?? status}: ${err.message ?? "error"}`);
}

/**
 * Fallo sin respuesta de Graph: timeout, abort o error de red. El POST pudo
 * haber llegado y Meta pudo haberlo procesado, así que el resultado es
 * desconocido. Un error con cuerpo de Graph (4xx/5xx con `error`) sí es
 * definitivo y no entra aquí.
 */
function isNoResponseError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError" || err instanceof TypeError;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Meta puede recortar espacios o saltos de línea: se comparan colapsados. */
function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * ¿El comentario ya tiene una respuesta con este texto? Lee las respuestas
 * del comentario y devuelve la primera cuyo texto coincide.
 * Instagram: GET /{ig-comment-id}/replies?fields=id,text
 * Facebook:  GET /{comment-id}/comments?fields=id,message
 *
 * Lanza si Graph falla: quien llama decide qué hacer cuando no se puede saber.
 */
export async function findCommentReply(
  platform: "INSTAGRAM" | "FACEBOOK",
  pageToken: string,
  commentId: string,
  message: string
): Promise<{ id: string } | null> {
  const url =
    platform === "INSTAGRAM"
      ? `${GRAPH}/${commentId}/replies?fields=id,text`
      : `${GRAPH}/${commentId}/comments?fields=id,message`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${pageToken}` },
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.error) throw graphError("Comment replies", res.status, data);
  const rows = Array.isArray(data.data) ? (data.data as Array<Record<string, unknown>>) : [];
  for (const row of rows) {
    const text = platform === "INSTAGRAM" ? row.text : row.message;
    if (typeof row.id === "string" && typeof text === "string" && sameText(text, message)) {
      return { id: row.id };
    }
  }
  return null;
}

/**
 * Respuesta pública al comentario.
 * Instagram: POST /{ig-comment-id}/replies · Facebook: POST /{comment-id}/comments
 *
 * Si el POST se queda sin respuesta (timeout o red), o Graph contesta 200 sin
 * id (el cuerpo se cortó), el resultado es desconocido: antes de fallar se
 * comprueba si Meta la publicó igual. Si aparece una respuesta con el mismo
 * texto, es un éxito con ese id (`recovered: true`). Si no aparece, o no se
 * puede comprobar, se lanza con el error original más lo que dijo la
 * verificación, para que quien vea el log sepa si reintentar es seguro.
 */
export async function replyToComment(
  platform: "INSTAGRAM" | "FACEBOOK",
  pageToken: string,
  commentId: string,
  message: string,
  opts: { verifyDelayMs?: number } = {}
): Promise<{ id: string; recovered?: true }> {
  const edge = platform === "INSTAGRAM" ? "replies" : "comments";

  const verifyOrThrow = async (original: unknown): Promise<{ id: string; recovered: true }> => {
    await sleep(opts.verifyDelayMs ?? VERIFY_DELAY_MS);
    let found: { id: string } | null;
    try {
      found = await findCommentReply(platform, pageToken, commentId, message);
    } catch (verifyErr) {
      throw new Error(
        `${errorMessage(original)} — no se pudo verificar en Meta si se publicó (${errorMessage(verifyErr)})`
      );
    }
    if (found) return { id: found.id, recovered: true };
    throw new Error(`${errorMessage(original)} — verificado en Meta: la respuesta no aparece publicada`);
  };

  let res: Awaited<ReturnType<typeof postJson>>;
  try {
    res = await postJson(`${GRAPH}/${commentId}/${edge}`, {
      message,
      access_token: pageToken,
    });
  } catch (err) {
    if (!isNoResponseError(err)) throw err;
    return verifyOrThrow(err);
  }
  const { ok, status, data } = res;
  if (!ok || data.error) throw graphError("Comment reply", status, data);
  const id = typeof data.id === "string" ? data.id : null;
  if (!id) return verifyOrThrow(new Error("Comment reply sin id en la respuesta de Graph"));
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
  const { ok, status, data } = await postJson(`${GRAPH}/me/messages`, {
    recipient: { comment_id: commentId },
    message: { text },
    access_token: pageToken,
  });
  if (!ok || data.error) throw graphError("Private reply", status, data);
  const messageId = typeof data.message_id === "string" ? data.message_id : null;
  if (!messageId) throw new Error("Private reply sin message_id en la respuesta de Graph");
  return {
    messageId,
    recipientId: typeof data.recipient_id === "string" ? data.recipient_id : null,
  };
}
