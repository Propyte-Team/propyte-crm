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
// defensivo: nunca lanza, y cualquier forma que no reconozca devuelve [].

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

interface RawEntry {
  id?: string;
  changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseIg(entryId: string, value: Record<string, unknown>): IncomingComment | null {
  const from = (value.from ?? {}) as Record<string, unknown>;
  const media = (value.media ?? {}) as Record<string, unknown>;
  const id = str(value.id);
  const text = str(value.text);
  const authorId = str(from.id);
  const postId = str(media.id);
  if (!id || !text || !authorId || !postId) return null;

  return {
    platform: "INSTAGRAM",
    accountId: entryId,
    externalCommentId: id,
    postId,
    authorId,
    authorHandle: str(from.username),
    text,
    isNested: !!str(value.parent_id),
  };
}

function parseFb(entryId: string, value: Record<string, unknown>): IncomingComment | null {
  if (value.item !== "comment" || value.verb !== "add") return null;

  const from = (value.from ?? {}) as Record<string, unknown>;
  const id = str(value.comment_id);
  const text = str(value.message);
  const authorId = str(from.id);
  const postId = str(value.post_id);
  if (!id || !text || !authorId || !postId) return null;

  const parentId = str(value.parent_id);
  return {
    platform: "FACEBOOK",
    accountId: entryId,
    externalCommentId: id,
    postId,
    authorId,
    authorHandle: str(from.name),
    text,
    isNested: !!parentId && parentId !== postId,
  };
}

export function parseCommentWebhook(body: unknown): IncomingComment[] {
  if (!body || typeof body !== "object") return [];
  const { object, entry } = body as { object?: string; entry?: unknown };
  if (object !== "instagram" && object !== "page") return [];
  if (!Array.isArray(entry)) return [];

  const out: IncomingComment[] = [];
  for (const raw of entry as RawEntry[]) {
    const entryId = str(raw?.id);
    if (!entryId || !Array.isArray(raw.changes)) continue;

    for (const change of raw.changes) {
      const value = change?.value;
      if (!value || typeof value !== "object") continue;

      const parsed =
        object === "instagram" && change.field === "comments"
          ? parseIg(entryId, value)
          : object === "page" && change.field === "feed"
            ? parseFb(entryId, value)
            : null;

      if (parsed) out.push(parsed);
    }
  }
  return out;
}
