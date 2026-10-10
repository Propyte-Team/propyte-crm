import type { SendResult } from "./types";

const GRAPH = "https://graph.facebook.com/v24.0";

/**
 * Rechazo de la Send API con los datos de Meta (2026-10-10). El mensaje es el
 * mismo de siempre ("Graph send {code}: {mensaje}") para no romper a quien ya
 * lo lee; además viajan `code` y `subcode` sueltos, que son los que distinguen
 * "otra app controla el hilo" de "falta el permiso" o "fuera de la ventana de
 * 24 h" (ver lib/messaging/send-failure.ts).
 */
export class GraphSendError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly graphMessage: string | null;

  constructor(
    prefix: string,
    status: number,
    error: { code?: number; error_subcode?: number; message?: string } | undefined
  ) {
    super(`${prefix} ${error?.code ?? status}: ${error?.message ?? "error"}`);
    this.name = "GraphSendError";
    this.status = status;
    this.code = typeof error?.code === "number" ? error.code : null;
    this.subcode = typeof error?.error_subcode === "number" ? error.error_subcode : null;
    this.graphMessage = typeof error?.message === "string" ? error.message : null;
  }
}

type GraphSendBody = {
  message_id?: string;
  error?: { code?: number; error_subcode?: number; message?: string };
};

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
  const data = (await res.json().catch(() => ({}))) as GraphSendBody;
  if (!res.ok || data.error) {
    // 10/200 = fuera de ventana de 24h / sin permiso de mensajería estándar
    throw new GraphSendError("Graph send", res.status, data.error);
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
  const data = (await res.json().catch(() => ({}))) as GraphSendBody;
  if (!res.ok || data.error) {
    throw new GraphSendError("Graph attachment", res.status, data.error);
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
