// Payload de comentarios de Meta → forma normalizada. Función pura.
//
// Instagram (object "instagram", field "comments"):
//   value = { id, text, from:{id, username}, media:{id}, parent_id? }
// Facebook (object "page", field "feed"):
//   value = { item, verb, comment_id, post_id, parent_id, from:{id, name}, message }
//
// OJO Facebook: en un comentario de primer nivel `parent_id` viene IGUAL al
// `post_id`. Solo es respuesta anidada cuando difieren.
//
// Este mismo endpoint recibe también el payload de DMs (entry[].messaging),
// porque Meta solo permite una callback URL por objeto. Por eso todo aquí es
// defensivo: nunca lanza, y cualquier forma que no reconozca se ignora en
// silencio (no es un descarte: nunca fue un comentario).
//
// `discarded`: cuando SÍ era un comentario (pasó el gate de object/field, y en
// Facebook además item==="comment" && verb==="add") pero le faltó un campo
// obligatorio. Caso real de producción: Meta omite `from` cuando el
// comentarista bloqueó la Página, cuando falta el permiso
// `pages_read_engagement`, o cuando la cuenta fue borrada. Sin esto, ese
// comentario se perdía sin dejar rastro — nunca llegaba a crear un
// CommentRuleLog, así que no había forma de saber cuántos comentarios de
// clientes reales se estaban cayendo. La función sigue siendo pura (no
// loguea ni escribe); es responsabilidad del webhook (Task 8) emitir el
// console.warn por cada descarte.

export type DiscardReason = "sin-id" | "sin-autor" | "sin-publicacion" | "sin-texto";

export interface DiscardedComment {
  platform: "INSTAGRAM" | "FACEBOOK";
  accountId: string; // entry.id → igBusinessId (IG) o pageId (FB)
  externalCommentId: string | null;
  reason: DiscardReason;
}

export interface IncomingComment {
  platform: "INSTAGRAM" | "FACEBOOK";
  accountId: string; // entry.id → igBusinessId (IG) o pageId (FB)
  externalCommentId: string;
  postId: string;
  authorId: string;
  authorHandle: string | null;
  text: string;
  isNested: boolean;
}

export interface ParsedCommentWebhook {
  comments: IncomingComment[];
  discarded: DiscardedComment[];
}

interface RawEntry {
  id?: string;
  changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
}

// Resultado interno de intentar parsear un `value` que ya se sabe es un
// comentario (pasó el gate de object/field/item/verb):
//   - "ok": se armó el IncomingComment completo.
//   - "discarded": faltó un campo obligatorio; trae la razón determinista.
//   - null: NO se llega a intentar (ni siquiera es un comentario), p. ej.
//     Facebook con verb distinto de "add" — el llamador lo ignora sin más.
type ParseAttempt =
  | { kind: "ok"; comment: IncomingComment }
  | { kind: "discarded"; reason: DiscardReason; externalCommentId: string | null }
  | null;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Precedencia determinista de la razón de descarte: primero la identidad
// (id, autor, publicación) y al final el contenido (texto).
function parseIg(entryId: string, value: Record<string, unknown>): ParseAttempt {
  const from = (value.from ?? {}) as Record<string, unknown>;
  const media = (value.media ?? {}) as Record<string, unknown>;
  const id = str(value.id);
  const authorId = str(from.id);
  const postId = str(media.id);
  const text = str(value.text);

  if (!id) return { kind: "discarded", reason: "sin-id", externalCommentId: null };
  if (!authorId) return { kind: "discarded", reason: "sin-autor", externalCommentId: id };
  if (!postId) return { kind: "discarded", reason: "sin-publicacion", externalCommentId: id };
  if (!text) return { kind: "discarded", reason: "sin-texto", externalCommentId: id };

  return {
    kind: "ok",
    comment: {
      platform: "INSTAGRAM",
      accountId: entryId,
      externalCommentId: id,
      postId,
      authorId,
      authorHandle: str(from.username),
      text,
      isNested: !!str(value.parent_id),
    },
  };
}

function parseFb(entryId: string, value: Record<string, unknown>): ParseAttempt {
  if (value.item !== "comment" || value.verb !== "add") return null;

  const from = (value.from ?? {}) as Record<string, unknown>;
  const id = str(value.comment_id);
  const authorId = str(from.id);
  const postId = str(value.post_id);
  const text = str(value.message);

  if (!id) return { kind: "discarded", reason: "sin-id", externalCommentId: null };
  if (!authorId) return { kind: "discarded", reason: "sin-autor", externalCommentId: id };
  if (!postId) return { kind: "discarded", reason: "sin-publicacion", externalCommentId: id };
  if (!text) return { kind: "discarded", reason: "sin-texto", externalCommentId: id };

  const parentId = str(value.parent_id);
  return {
    kind: "ok",
    comment: {
      platform: "FACEBOOK",
      accountId: entryId,
      externalCommentId: id,
      postId,
      authorId,
      authorHandle: str(from.name),
      text,
      isNested: !!parentId && parentId !== postId,
    },
  };
}

export function parseCommentWebhook(body: unknown): ParsedCommentWebhook {
  const comments: IncomingComment[] = [];
  const discarded: DiscardedComment[] = [];

  if (!body || typeof body !== "object") return { comments, discarded };
  const { object, entry } = body as { object?: string; entry?: unknown };
  if (object !== "instagram" && object !== "page") return { comments, discarded };
  if (!Array.isArray(entry)) return { comments, discarded };

  const platform: "INSTAGRAM" | "FACEBOOK" = object === "instagram" ? "INSTAGRAM" : "FACEBOOK";

  for (const raw of entry as RawEntry[]) {
    const entryId = str(raw?.id);
    if (!entryId || !Array.isArray(raw.changes)) continue;

    for (const change of raw.changes) {
      const value = change?.value;
      if (!value || typeof value !== "object") continue;

      const attempt: ParseAttempt =
        object === "instagram" && change.field === "comments"
          ? parseIg(entryId, value)
          : object === "page" && change.field === "feed"
            ? parseFb(entryId, value)
            : null;

      if (!attempt) continue;
      if (attempt.kind === "ok") {
        comments.push(attempt.comment);
      } else {
        discarded.push({
          platform,
          accountId: entryId,
          externalCommentId: attempt.externalCommentId,
          reason: attempt.reason,
        });
      }
    }
  }
  return { comments, discarded };
}
