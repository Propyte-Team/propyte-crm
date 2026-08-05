// Bloqueo del remitente en Meta. Solo Graph: no toca la base de datos y NUNCA lanza —
// el estado que devuelve se guarda en BlockedSender y se puede reintentar.
//
// Instagram: POST /{page-id}/moderate_conversations con block_user y move_to_spam.
//   Exige que la conversación ya exista (limitación de Meta, no un bug nuestro).
// Messenger: POST /{page-id}/blocked con psid. No hay carpeta de spam por API.
// WhatsApp: no existe API de bloqueo.
import type { CommentActionStatus, MessageChannel } from "@prisma/client";

const V = "v24.0";
const ERROR_MAX = 500;

export interface MetaModerationResult {
  blockStatus: CommentActionStatus;
  spamStatus: CommentActionStatus;
  error?: string;
}

export interface BlockOnMetaArgs {
  channel: MessageChannel;
  pageId: string | null;
  token: string | null;
  identifier: string;
  fetchImpl?: typeof fetch;
}

/** Traduce los códigos de Meta a algo que un humano pueda leer en la UI. */
function humanError(code: number | undefined, message: string): string {
  if (code === 3801) return "Meta rechazó el bloqueo: el tope de personas bloqueadas de la Página está alcanzado.";
  if (code === 3802) return "Meta rechazó el bloqueo: desbloqueaste a esta persona hace muy poco, hay que esperar.";
  if (/no conversation/i.test(message)) {
    return "Instagram exige una conversación previa para bloquear. Este spam llegó solo por comentario, así que Meta no lo acepta; queda bloqueado en el CRM.";
  }
  return message.slice(0, ERROR_MAX);
}

async function post(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetchImpl(url, init);
  const json = (await res.json().catch(() => null)) as { error?: { code?: number; message?: string } } | null;
  if (res.status >= 200 && res.status < 300 && !json?.error) return { ok: true };
  return { ok: false, error: humanError(json?.error?.code, json?.error?.message ?? `HTTP ${res.status}`) };
}

async function moderateIg(
  pageId: string,
  token: string,
  identifier: string,
  action: "block_user" | "move_to_spam" | "unblock_user",
  fetchImpl: typeof fetch
) {
  return post(
    `https://graph.facebook.com/${V}/${pageId}/moderate_conversations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_ids: [{ id: identifier }], actions: [action], access_token: token }),
    },
    fetchImpl
  );
}

export async function blockOnMeta(args: BlockOnMetaArgs): Promise<MetaModerationResult> {
  const { channel, pageId, token, identifier } = args;
  const fetchImpl = args.fetchImpl ?? fetch;

  if (channel === "WHATSAPP" || channel === "SMS") {
    return {
      blockStatus: "SKIPPED",
      spamStatus: "SKIPPED",
      error: channel === "WHATSAPP" ? "WhatsApp no tiene API de bloqueo" : "SMS no tiene API de bloqueo",
    };
  }
  if (!token) return { blockStatus: "SKIPPED", spamStatus: "SKIPPED", error: "conector sin pageAccessToken" };
  if (!pageId) return { blockStatus: "SKIPPED", spamStatus: "SKIPPED", error: "conector sin pageId" };

  try {
    if (channel === "MESSENGER") {
      const url = new URL(`https://graph.facebook.com/${V}/${pageId}/blocked`);
      url.searchParams.set("psid", JSON.stringify([identifier]));
      url.searchParams.set("access_token", token);
      const r = await post(url.toString(), { method: "POST" }, fetchImpl);
      return r.ok
        ? { blockStatus: "SENT", spamStatus: "SKIPPED" }
        : { blockStatus: "FAILED", spamStatus: "SKIPPED", error: r.error };
    }

    const block = await moderateIg(pageId, token, identifier, "block_user", fetchImpl);
    if (!block.ok) return { blockStatus: "FAILED", spamStatus: "SKIPPED", error: block.error };

    const spam = await moderateIg(pageId, token, identifier, "move_to_spam", fetchImpl);
    return spam.ok
      ? { blockStatus: "SENT", spamStatus: "SENT" }
      : { blockStatus: "SENT", spamStatus: "FAILED", error: spam.error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { blockStatus: "FAILED", spamStatus: "SKIPPED", error: message.slice(0, ERROR_MAX) };
  }
}

/** Deshace el bloqueo. Nunca lanza: el desbloqueo del CRM no depende de que Meta responda. */
export async function unblockOnMeta(args: BlockOnMetaArgs): Promise<{ ok: boolean; error?: string }> {
  const { channel, pageId, token, identifier } = args;
  const fetchImpl = args.fetchImpl ?? fetch;

  if (channel === "WHATSAPP" || channel === "SMS") return { ok: true };
  if (!token || !pageId) return { ok: false, error: "conector sin token o sin pageId" };

  try {
    if (channel === "MESSENGER") {
      const url = new URL(`https://graph.facebook.com/${V}/${pageId}/blocked`);
      url.searchParams.set("psid", JSON.stringify([identifier]));
      url.searchParams.set("access_token", token);
      return await post(url.toString(), { method: "DELETE" }, fetchImpl);
    }
    return await moderateIg(pageId, token, identifier, "unblock_user", fetchImpl);
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX) };
  }
}
