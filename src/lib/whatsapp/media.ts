// Media entrante de WhatsApp Cloud API: el webhook solo trae un media ID;
// hay que pedir la URL temporal (~5 min) a Graph y descargarla con Bearer.
// Best-effort: null si falla (el mensaje se procesa igual con placeholder).
import { mirrorExternalMedia } from "@/lib/storage/chat-media";

const GRAPH = "https://graph.facebook.com/v24.0";
const META_TIMEOUT_MS = 4000;

/** Resuelve un media ID de WA Cloud → archivo persistido en el bucket chat-media. */
export async function resolveWaMediaToStorage(
  mediaId: string
): Promise<{ path: string; mimeType: string | null } | null> {
  try {
    const token = process.env.META_WA_ACCESS_TOKEN?.trim();
    if (!token || !mediaId) return null;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), META_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${GRAPH}/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { url?: string } | null;
    if (!data?.url) return null;

    return await mirrorExternalMedia(data.url, token);
  } catch {
    return null;
  }
}
