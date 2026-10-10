// Dejar la Página suscrita a lo que el CRM necesita, sin quitarle nada (2026-10-10).
//
// Por qué vive aparte: lo usan dos rutas — el botón «Suscribir página»
// (/api/admin/connectors/[id]/subscribe) y el alta de Meta DMs, que suscribe la Página
// en cuanto crea las cuentas. Si cada una llevara su copia, un día una leería antes de
// escribir y la otra no, y esa es justo la que borraría los campos que alguien suscribió
// a mano. Va en un módulo distinto de webhook-subscription.ts para que las pruebas que
// simulan probePageSubscription/subscribePage sigan viendo sus dobles.
import {
  probePageSubscription,
  missingPageFields,
  fieldsToSubscribe,
  subscribePage,
} from "./webhook-subscription";

export type EnsureSubscriptionResult =
  | { ok: true; changed: boolean; subscribedFields: string[]; missing: string[] }
  // "read": no se pudo leer lo que ya tenía (no se escribió nada a ciegas).
  // "subscribe": se leyó, pero Meta no aceptó la suscripción.
  | { ok: false; stage: "read" | "subscribe"; error: string };

/**
 * Lee los campos actuales, y si falta alguno de REQUIRED_PAGE_FIELDS manda lo que había más
 * lo que falta (el POST de Meta REEMPLAZA la lista). Después vuelve a leer para devolver lo
 * que de verdad quedó. Nunca lanza: los helpers de Graph ya devuelven el error como texto.
 */
export async function ensurePageSubscription(pageId: string, pageToken: string): Promise<EnsureSubscriptionResult> {
  const before = await probePageSubscription(pageId, pageToken);
  if (before.error) return { ok: false, stage: "read", error: before.error };
  if (missingPageFields(before.subscribedFields).length === 0) {
    return { ok: true, changed: false, subscribedFields: before.subscribedFields, missing: [] };
  }

  const wanted = fieldsToSubscribe(before.subscribedFields);
  const result = await subscribePage(pageId, pageToken, wanted);
  if (!result.ok) return { ok: false, stage: "subscribe", error: result.error ?? "error" };

  // Confirmar con Meta en vez de suponer: lo que se muestra es lo que quedó. Si la segunda
  // lectura falla, Meta ya aceptó el POST: se informa lo que se mandó.
  const after = await probePageSubscription(pageId, pageToken);
  return {
    ok: true,
    changed: true,
    subscribedFields: after.error ? wanted : after.subscribedFields,
    missing: after.error ? [] : missingPageFields(after.subscribedFields),
  };
}
