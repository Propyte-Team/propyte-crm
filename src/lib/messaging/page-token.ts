// Cambiar el Page Access Token de una cuenta de IG/Messenger sin perder lo demás (2026-10-10).
//
// Por qué existe: Marketing tiene que reemplazar el token de 10 cuentas por los de un
// usuario del sistema de Meta. Con 10 tokens en el portapapeles es fácil pegar el de otra
// Página, y un token equivocado no falla al guardarlo: falla días después, en silencio,
// cuando el bot intenta contestar desde la Página que no es. `GET /me` con un token de
// Página devuelve la Página misma, así que basta comparar su id con el `config.pageId` de
// la cuenta ANTES de escribir nada.
//
// El token va en la cabecera `Authorization` y nunca en la URL (mismo criterio que
// webhook-subscription.ts): las URLs acaban en logs y una URL con token es una fuga.
const GRAPH = "https://graph.facebook.com/v24.0";
const TIMEOUT_MS = 8000;

export type PageTokenCheck =
  | { ok: true; pageId: string; pageName: string }
  // "graph": Meta contestó y rechazó el token (caducado, inválido…) → culpa del token.
  // "network": no hubo respuesta usable (timeout, red caída) → no sabemos nada del token.
  | { ok: false; kind: "graph" | "network"; error: string };

/**
 * Hay mensajes de Graph que repiten el token recibido (p. ej. "Malformed access token
 * EAAB…"). Ese texto se muestra en pantalla, así que se tapa antes de devolverlo.
 * Exportada (2026-10-10) para que el alta de Meta DMs tape también los errores de la
 * suscripción de la Página, que salen del mismo token.
 */
export function scrubToken(text: string, token: string): string {
  const clean = token ? text.split(token).join("[token]") : text;
  return clean.slice(0, 300);
}

type GraphFailure = { ok: false; kind: "graph" | "network"; error: string };

/** Excepción de fetch → fallo de red legible y sin el token. */
function networkFailure(err: unknown, token: string): GraphFailure {
  // AbortSignal.timeout aborta con un DOMException "TimeoutError"; se mira el nombre y no
  // `instanceof Error` porque no todos los entornos lo hacen heredar de Error.
  const name = (err as { name?: string } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return { ok: false, kind: "network", error: "Meta no respondió a tiempo" };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, kind: "network", error: scrubToken(message, token) };
}

/**
 * `GET /me?fields=id,name` con el token: ¿de qué Página es? Nunca lanza: un error de Graph
 * o de red sale como `error` legible para la pantalla. `fetchImpl` y `timeoutMs` son
 * inyectables para las pruebas.
 */
export async function verifyPageToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = TIMEOUT_MS
): Promise<PageTokenCheck> {
  try {
    const res = await fetchImpl(`${GRAPH}/me?fields=id,name`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string | number;
      name?: string;
      error?: { message?: string; code?: number };
    };
    if (!res.ok || body.error || body.id == null || body.id === "") {
      const err = body.error ?? {};
      return {
        ok: false,
        kind: "graph",
        error: scrubToken(`Graph ${err.code ?? res.status}: ${err.message ?? "respuesta sin id"}`, token),
      };
    }
    return { ok: true, pageId: String(body.id), pageName: body.name ?? "" };
  } catch (err) {
    return networkFailure(err, token);
  }
}

// Instagram vinculado a la Página (2026-10-10).
//
// Por qué existe: la cuenta de Messenger y la de Instagram de una marca comparten Página y
// token; lo único propio de la de IG es su igBusinessId, y copiarlo a mano de Meta es donde
// se cuelan errores (el de otra marca, uno de prueba). La Página ya sabe qué cuenta de IG
// tiene vinculada: el asistente la propone y el alta la comprueba antes de guardar.
export type LinkedInstagramCheck =
  | { ok: true; instagram: { id: string; username: string } | null }
  | GraphFailure;

/**
 * `GET /{pageId}?fields=instagram_business_account{id,username}` con el token en la cabecera.
 * `instagram: null` = la Página no tiene cuenta de IG Business vinculada (Graph omite el campo).
 * Nunca lanza, igual que verifyPageToken.
 */
export async function fetchLinkedInstagram(
  pageId: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = TIMEOUT_MS
): Promise<LinkedInstagramCheck> {
  try {
    const fields = encodeURIComponent("instagram_business_account{id,username}");
    const res = await fetchImpl(`${GRAPH}/${encodeURIComponent(pageId)}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as {
      instagram_business_account?: { id?: string | number; username?: string } | null;
      error?: { message?: string; code?: number };
    };
    if (!res.ok || body.error) {
      const err = body.error ?? {};
      return {
        ok: false,
        kind: "graph",
        error: scrubToken(`Graph ${err.code ?? res.status}: ${err.message ?? "error"}`, token),
      };
    }
    const ig = body.instagram_business_account;
    if (!ig || ig.id == null || ig.id === "") return { ok: true, instagram: null };
    return { ok: true, instagram: { id: String(ig.id), username: ig.username ?? "" } };
  } catch (err) {
    return networkFailure(err, token);
  }
}

/** Texto para cuando el token es de otra Página: dice cuál es cada una para poder corregirlo. */
export function pageMismatchMessage(found: { pageId: string; pageName: string }, expectedPageId: string): string {
  const name = found.pageName || "sin nombre";
  return (
    `Este token es de la página «${name}» (${found.pageId}), no de la de esta cuenta (${expectedPageId}). ` +
    "Si pegaste el token del usuario del sistema, usa el Page Access Token de la página."
  );
}

/**
 * Credenciales nuevas = las de antes con SOLO el token cambiado. Existe porque el PATCH de
 * /api/admin/connectors/[id] reemplaza el blob completo, y mandarle solo el token borraría
 * appSecret y verifyToken. No muta la entrada.
 */
export function mergePageToken(
  existing: Record<string, unknown> | null,
  pageAccessToken: string
): Record<string, unknown> {
  return { ...(existing ?? {}), pageAccessToken };
}
