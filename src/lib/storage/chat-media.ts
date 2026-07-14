// Bucket privado `chat-media` (Supabase Storage): media del inbox.
// Sin policies — todo acceso pasa por service role o signed URLs (subida y lectura).
// Subida desde el navegador SIEMPRE vía signed upload URL directa a Supabase
// (Hostinger trunca multipart >1-2MB si pasa por la API del CRM).
import { randomUUID } from "crypto";
import { getSupabaseServiceClient } from "@/lib/supabase";

export const CHAT_MEDIA_BUCKET = "chat-media";
const MIRROR_TIMEOUT_MS = 8000;
const MIRROR_MAX_BYTES = 25 * 1024 * 1024;

/** true si el valor es un path del bucket (no una URL externa http/https). */
export function isStoragePath(value: string): boolean {
  return !/^https?:\/\//i.test(value);
}

function extFromMime(mime: string | null | undefined): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/wav": "wav",
    "video/mp4": "mp4", "application/pdf": "pdf",
  };
  return (mime && map[mime.split(";")[0].trim().toLowerCase()]) || "bin";
}

export function newChatMediaPath(ext: string): string {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${ym}/${randomUUID()}.${safeExt}`;
}

/** Sube un buffer al bucket. Devuelve el path o null (best-effort, nunca lanza). */
export async function uploadChatMedia(
  buffer: ArrayBuffer | Buffer,
  mimeType: string | null | undefined,
  ext?: string
): Promise<string | null> {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) return null;
    const path = newChatMediaPath(ext ?? extFromMime(mimeType));
    const { error } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(path, buffer, { contentType: mimeType ?? "application/octet-stream", upsert: false });
    if (error) {
      console.warn("[chat-media] upload falló:", error.message ?? error);
      return null;
    }
    return path;
  } catch (err) {
    console.warn("[chat-media] upload lanzó:", err);
    return null;
  }
}

/**
 * Descarga una URL efímera (CDN de Meta) y la persiste en el bucket.
 * authToken → header Bearer (media de WhatsApp Cloud). null si falla (nunca lanza).
 */
export async function mirrorExternalMedia(
  url: string,
  authToken?: string
): Promise<{ path: string; mimeType: string | null } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MIRROR_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        signal: ctrl.signal,
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MIRROR_MAX_BYTES) return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MIRROR_MAX_BYTES) return null;
    const mimeType = res.headers.get("content-type")?.split(";")[0].trim() ?? null;
    const path = await uploadChatMedia(buffer, mimeType);
    return path ? { path, mimeType } : null;
  } catch {
    return null;
  }
}

/** Signed URLs de lectura (24h) para paths del bucket. Devuelve map path→url (los que fallen no aparecen). */
export async function signChatMediaUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p) => p && isStoragePath(p)))];
  if (!unique.length) return {};
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) return {};
    const { data, error } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .createSignedUrls(unique, 60 * 60 * 24);
    if (error || !data) return {};
    const out: Record<string, string> = {};
    for (const row of data as Array<{ path: string | null; signedUrl: string | null; error?: string | null }>) {
      if (row.path && row.signedUrl && !row.error) out[row.path] = row.signedUrl;
    }
    return out;
  } catch {
    return {};
  }
}

/** Signed upload URL para que el NAVEGADOR suba directo a Supabase (PUT signedUrl con el archivo). */
export async function createChatMediaUploadUrl(
  ext: string
): Promise<{ path: string; signedUrl: string; token: string } | null> {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) return null;
    const path = newChatMediaPath(ext);
    const { data, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) return null;
    return { path, signedUrl: data.signedUrl, token: data.token };
  } catch {
    return null;
  }
}
