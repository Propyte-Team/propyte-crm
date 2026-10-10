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

// Suscribir la Página (2026-10-10).
//
// Que la app tenga los campos a nivel aplicación no basta: además hay que
// "instalar" la app en cada Página con `POST /{page-id}/subscribed_apps`. Sin
// eso Meta no manda nada de esa Página — es lo que le pasó a Yaxnáh, con la
// app bien configurada y cero campos en la Página.
//
// Lo que necesita el CRM de cada Página: DMs (`messages`), lo que contesta la
// propia Página desde Meta Business Suite (`message_echoes`) y los comentarios
// de Facebook (`feed`). En una cuenta de Instagram es la Página vinculada: los
// DMs de IG también necesitan la app instalada ahí.
export const REQUIRED_PAGE_FIELDS = ["messages", "message_echoes", "feed"] as const;

/** De los campos que el CRM necesita en la Página, los que faltan. */
export function missingPageFields(subscribedFields: string[]): string[] {
  return REQUIRED_PAGE_FIELDS.filter((f) => !subscribedFields.includes(f));
}

/**
 * Lo que hay que mandar a Meta: lo que ya tiene más lo que falta. El POST
 * REEMPLAZA la lista completa de la app en esa Página, así que mandar solo lo
 * nuevo borraría lo que alguien suscribió a mano.
 */
export function fieldsToSubscribe(subscribedFields: string[]): string[] {
  return [...new Set([...subscribedFields, ...REQUIRED_PAGE_FIELDS])];
}

export interface SubscribeResult {
  ok: boolean;
  error: string | null;
}

/**
 * `POST /{page-id}/subscribed_apps` con el token de la Página, en la cabecera
 * como en el probe. Nunca lanza: el error de Graph sale como texto para la
 * pantalla.
 */
export async function subscribePage(
  pageId: string,
  pageToken: string,
  fields: string[],
  fetchImpl: typeof fetch = fetch
): Promise<SubscribeResult> {
  try {
    const res = await fetchImpl(`${GRAPH}/${pageId}/subscribed_apps`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pageToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ subscribed_fields: fields.join(",") }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: { message?: string; code?: number };
    };
    if (!res.ok || body.error || body.success !== true) {
      const err = body.error ?? {};
      return { ok: false, error: `Graph ${err.code ?? res.status}: ${err.message ?? "error"}` };
    }
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
