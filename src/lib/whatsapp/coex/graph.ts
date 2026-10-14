// Llamadas a Graph del alta por Embedded Signup en coexistencia (2026-10-14).
// Spec: docs/superpowers/specs/2026-10-14-whatsapp-coexistencia-design.md §3 y §5.
//
// Todas son servidor a servidor (la doc lo exige: «Do not use client-side requests») y NINGUNA
// lanza: un fallo de Graph o de red vuelve como `{ ok: false, kind, error }` con un texto que ya
// se puede mostrar. «graph» = Meta contestó y dijo que no (culpa de los datos); «network» = no
// hubo respuesta usable (no sabemos nada). Mismo contrato que lib/messaging/page-token.ts.
//
// Los secretos (token de negocio, App Secret, código de Embedded Signup) se tapan en todo texto
// que salga de aquí: hay mensajes de Graph que repiten lo que recibieron y ese texto acaba en la
// pantalla. El token va siempre en la cabecera `Authorization`, nunca en la URL; la única URL con
// secretos es la del canje del código, que la doc define así (GET con client_secret y code) y que
// por eso nunca se registra.
export const META_GRAPH_VERSION = "v24.0";
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const TIMEOUT_MS = 10_000;

export type GraphFailure = { ok: false; kind: "graph" | "network"; error: string; code?: number };

export interface GraphDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Tapa cada secreto en `text` y recorta a 300 caracteres (lo que cabe en un aviso). */
export function scrubSecrets(text: string, secrets: Array<string | null | undefined>): string {
  let clean = text;
  for (const s of secrets) {
    if (s && s.length >= 4) clean = clean.split(s).join("[oculto]");
  }
  return clean.slice(0, 300);
}

type GraphBody = Record<string, unknown> & {
  error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };
};

/** Una llamada a Graph. Devuelve el cuerpo si salió bien o el fallo ya limpio. */
async function graphCall(
  url: string,
  init: RequestInit,
  secrets: Array<string | null | undefined>,
  deps: GraphDeps,
): Promise<{ ok: true; body: GraphBody } | GraphFailure> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS) });
    const body = (await res.json().catch(() => ({}))) as GraphBody;
    if (!res.ok || body.error) {
      const err = body.error ?? {};
      const detail = err.error_user_msg || err.message || `HTTP ${res.status}`;
      return {
        ok: false,
        kind: "graph",
        code: typeof err.code === "number" ? err.code : undefined,
        error: scrubSecrets(`Graph ${err.code ?? res.status}: ${detail}`, secrets),
      };
    }
    return { ok: true, body };
  } catch (err) {
    // AbortSignal.timeout aborta con "TimeoutError"; se mira el nombre porque no todos los
    // entornos lo hacen heredar de Error.
    const name = (err as { name?: string } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, kind: "network", error: "Meta no respondió a tiempo" };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "network", error: scrubSecrets(message, secrets) };
  }
}

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Paso 1 del alta (Onboarding as a Tech Provider): canjea el código de Embedded Signup por el
 * token de negocio. `GET /oauth/access_token?client_id&client_secret&code`. El código vive 30 s:
 * esta es la primera llamada del alta, antes que cualquier otra cosa lenta.
 *
 * La doc solo muestra `<BUSINESS_TOKEN>` como respuesta; se lee `access_token`, que es la
 * respuesta OAuth estándar de Graph (spec §3, «no verificado»).
 */
export async function exchangeCodeForToken(
  input: { code: string; appId: string; appSecret: string },
  deps: GraphDeps = {},
): Promise<{ ok: true; accessToken: string } | GraphFailure> {
  const qs = new URLSearchParams({ client_id: input.appId, client_secret: input.appSecret, code: input.code });
  const r = await graphCall(`${GRAPH}/oauth/access_token?${qs}`, { method: "GET" }, [input.appSecret, input.code], deps);
  if (!r.ok) return r;
  const token = typeof r.body.access_token === "string" ? r.body.access_token : "";
  if (!token) return { ok: false, kind: "graph", error: "Meta no devolvió el token de negocio" };
  return { ok: true, accessToken: token };
}

/** Paso 2: suscribe la app a los webhooks de la WABA del cliente (`POST /{waba}/subscribed_apps`). */
export async function subscribeAppToWaba(
  wabaId: string,
  token: string,
  deps: GraphDeps = {},
): Promise<{ ok: true } | GraphFailure> {
  const r = await graphCall(
    `${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`,
    { method: "POST", headers: authHeader(token) },
    [token],
    deps,
  );
  if (!r.ok) return r;
  if (r.body.success === false) return { ok: false, kind: "graph", error: "Meta no confirmó la suscripción a la WABA" };
  return { ok: true };
}

export interface PhoneNumberInfo {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
  /** Coexistencia: true = el número sigue en la app de WhatsApp Business. undefined = Meta no lo dijo. */
  isOnBizApp?: boolean;
  platformType?: string;
}

function toPhoneInfo(raw: Record<string, unknown>): PhoneNumberInfo | null {
  const id = raw.id == null ? "" : String(raw.id);
  if (!id) return null;
  return {
    id,
    displayPhoneNumber: typeof raw.display_phone_number === "string" ? raw.display_phone_number : "",
    verifiedName: typeof raw.verified_name === "string" ? raw.verified_name : "",
    ...(typeof raw.is_on_biz_app === "boolean" ? { isOnBizApp: raw.is_on_biz_app } : {}),
    ...(typeof raw.platform_type === "string" ? { platformType: raw.platform_type } : {}),
  };
}

/**
 * Datos del número: lo que se muestra en Conexiones y el estado de coexistencia
 * (`is_on_biz_app`, `platform_type`, «Check onboarding status» de la doc de coexistencia).
 */
export async function fetchPhoneNumber(
  phoneNumberId: string,
  token: string,
  deps: GraphDeps = {},
): Promise<{ ok: true; info: PhoneNumberInfo } | GraphFailure> {
  const fields = "id,display_phone_number,verified_name,is_on_biz_app,platform_type";
  const r = await graphCall(
    `${GRAPH}/${encodeURIComponent(phoneNumberId)}?fields=${fields}`,
    { method: "GET", headers: authHeader(token) },
    [token],
    deps,
  );
  if (!r.ok) return r;
  const info = toPhoneInfo(r.body);
  if (!info) return { ok: false, kind: "graph", error: "Meta no devolvió los datos del número" };
  return { ok: true, info };
}

/**
 * Números de la WABA. Hace falta porque el evento de fin de coexistencia, según el ejemplo de la
 * doc, solo trae `waba_id` (el genérico de v4 sí trae `phone_number_id`).
 */
export async function listWabaPhoneNumbers(
  wabaId: string,
  token: string,
  deps: GraphDeps = {},
): Promise<{ ok: true; numbers: PhoneNumberInfo[] } | GraphFailure> {
  const r = await graphCall(
    `${GRAPH}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`,
    { method: "GET", headers: authHeader(token) },
    [token],
    deps,
  );
  if (!r.ok) return r;
  const data = Array.isArray(r.body.data) ? (r.body.data as Array<Record<string, unknown>>) : [];
  return { ok: true, numbers: data.map(toPhoneInfo).filter((n): n is PhoneNumberInfo => n !== null) };
}

export type SmbSyncType = "smb_app_state_sync" | "history";

/**
 * Pide a Meta la sincronización de la app (`POST /{phone_number_id}/smb_app_data`): contactos
 * (`smb_app_state_sync`) o historial (`history`). Cada una se puede pedir UNA sola vez por
 * conexión y hay 24 h desde el alta; el resultado llega por webhook.
 */
export async function requestSmbAppData(
  phoneNumberId: string,
  token: string,
  syncType: SmbSyncType,
  deps: GraphDeps = {},
): Promise<{ ok: true; requestId: string | null } | GraphFailure> {
  const r = await graphCall(
    `${GRAPH}/${encodeURIComponent(phoneNumberId)}/smb_app_data`,
    {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", sync_type: syncType }),
    },
    [token],
    deps,
  );
  if (!r.ok) return r;
  return { ok: true, requestId: typeof r.body.request_id === "string" ? r.body.request_id : null };
}
