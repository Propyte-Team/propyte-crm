import type { SendResult } from "./types";

const GRAPH = "https://graph.facebook.com/v24.0";

/** Envía un mensaje de texto a un PSID/IGSID por la Send API de la página. */
export async function sendGraphMessage(
  pageToken: string,
  recipientId: string,
  text: string
): Promise<SendResult> {
  const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    message_id?: string;
    error?: { code?: number; message?: string };
  };
  if (!res.ok || data.error) {
    const code = data.error?.code;
    // 10/200 = fuera de ventana de 24h / sin permiso de mensajería estándar
    throw new Error(`Graph send ${code ?? res.status}: ${data.error?.message ?? "error"}`);
  }
  return { externalMessageId: data.message_id ?? `graph-${Date.now()}`, status: "SENT" };
}

/** Envía un attachment (media) a un PSID/IGSID por la Send API. La URL debe ser pública/firmada. */
export async function sendGraphAttachment(
  pageToken: string,
  recipientId: string,
  attachment: { url: string; type: "image" | "audio" | "video" | "file" }
): Promise<SendResult> {
  const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { attachment: { type: attachment.type, payload: { url: attachment.url, is_reusable: false } } },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    message_id?: string;
    error?: { code?: number; message?: string };
  };
  if (!res.ok || data.error) {
    const code = data.error?.code;
    throw new Error(`Graph attachment ${code ?? res.status}: ${data.error?.message ?? "error"}`);
  }
  return { externalMessageId: data.message_id ?? `graph-${Date.now()}`, status: "SENT" };
}

/** Nombre/usuario del perfil (best-effort; puede fallar por permisos). */
export async function fetchGraphProfileName(pageToken: string, userId: string): Promise<string | null> {
  try {
    const res = await fetch(`${GRAPH}/${userId}?fields=name,username&access_token=${encodeURIComponent(pageToken)}`);
    const data = (await res.json().catch(() => ({}))) as { name?: string; username?: string };
    return data.name ?? data.username ?? null;
  } catch {
    return null;
  }
}
