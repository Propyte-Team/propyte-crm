// ¿Está la Página suscrita a los eventos que necesitamos?
//
// Por qué existe: las reglas de comentarios pueden estar perfectas y no
// disparar nunca porque Meta jamás nos manda el evento. Eso no deja rastro en
// ninguna parte — no hay error, no hay log, simplemente silencio— y hasta ahora
// la única forma de descartarlo era entrar al panel de la app en Meta. Esto lo
// convierte en un dato que el CRM puede mostrar.
//
// Alcance real, para no prometer de más:
//  - Messenger/Facebook: `feed` es el campo que trae los comentarios de las
//    publicaciones de la Página, y `messages` los DMs. Se comprueban de verdad.
//  - Instagram: los comentarios de IG llegan por el objeto `instagram` de la
//    app, que se configura a nivel APLICACIÓN y solo se puede leer con un app
//    access token (app_id|app_secret), que el CRM no tiene. Para esas cuentas
//    esto informa los campos de la Página vinculada, no la suscripción de IG.
const GRAPH = "https://graph.facebook.com/v24.0";
const TIMEOUT_MS = 8000;

/** Campos de Página sin los que un comentario de Facebook no llega nunca. */
export const COMMENT_FIELDS = ["feed"] as const;

export interface SubscriptionProbe {
  subscribedFields: string[];
  error: string | null;
}

/**
 * `GET /{page-id}/subscribed_apps` — qué campos tiene suscritos nuestra app en
 * esa Página. El token va en la cabecera `Authorization` y NO en el query
 * string: las URLs acaban en logs y una URL con token es una fuga (mismo
 * criterio que lib/comments/graph.ts).
 *
 * Nunca lanza: es un diagnóstico, y que Graph esté caído no debe tumbar la
 * pantalla de conectores. Todo fallo sale como `error` legible.
 */
export async function probePageSubscription(
  pageId: string,
  pageToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<SubscriptionProbe> {
  try {
    const res = await fetchImpl(`${GRAPH}/${pageId}/subscribed_apps?fields=subscribed_fields`, {
      headers: { Authorization: `Bearer ${pageToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: Array<{ subscribed_fields?: string[] }>;
      error?: { message?: string; code?: number };
    };
    if (!res.ok || body.error) {
      const err = body.error ?? {};
      return {
        subscribedFields: [],
        error: `Graph ${err.code ?? res.status}: ${err.message ?? "error"}`,
      };
    }
    // Una Página puede tener varias apps suscritas; nos importan los campos que
    // alguna de ellas escucha, porque el token con el que preguntamos es el
    // nuestro y Graph solo devuelve lo visible para esa app.
    const fields = (body.data ?? []).flatMap((row) => row.subscribed_fields ?? []);
    return { subscribedFields: [...new Set(fields)], error: null };
  } catch (err) {
    return {
      subscribedFields: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** De los campos imprescindibles para comentarios, los que faltan. */
export function missingCommentFields(subscribedFields: string[]): string[] {
  return COMMENT_FIELDS.filter((f) => !subscribedFields.includes(f));
}
