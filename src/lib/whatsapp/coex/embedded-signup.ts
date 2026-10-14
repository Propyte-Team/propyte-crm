// Embedded Signup v4 en el navegador (2026-10-14) — partes puras, probables sin DOM.
// Spec §3: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/
// y https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
//
// v4 la fija la configuración de Facebook Login for Business (productos seleccionados), no un
// campo `version`. La coexistencia se pide con `featureType: "whatsapp_business_app_onboarding"`
// («continues to be supported through the feature_type parameter», página de la v4) y
// `sessionInfoVersion: "3"`, como muestra la doc de coexistencia.

export const COEX_FEATURE_TYPE = "whatsapp_business_app_onboarding";

/** Opciones de `FB.login` para lanzar el flujo de coexistencia. */
export function embeddedSignupLoginOptions(configId: string) {
  return {
    config_id: configId,
    response_type: "code",
    override_default_response_type: true,
    extras: {
      setup: {},
      featureType: COEX_FEATURE_TYPE,
      sessionInfoVersion: "3",
    },
  };
}

export type EmbeddedSignupEvent =
  | { kind: "finish"; event: string; wabaId: string; phoneNumberId: string | null; coexistence: boolean }
  | { kind: "cancel"; step: string | null; errorMessage: string | null }
  | { kind: "error"; errorMessage: string | null }
  | { kind: "ignore" };

/** El origen del mensaje tiene que ser Facebook (la doc: `event.origin.endsWith("facebook.com")`). */
export function isFacebookOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "facebook.com" || host.endsWith(".facebook.com");
  } catch {
    return false;
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Interpreta el `message` de la sesión de Embedded Signup (`type: "WA_EMBEDDED_SIGNUP"`).
 * Fin: FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING (coexistencia) — el ejemplo de la doc solo trae
 * `waba_id` —, o FINISH (número nuevo, Cloud API), que se reporta con `coexistence: false` para
 * que la pantalla explique que ese caso es otro flujo. CANCEL trae `current_step` (abandono) o
 * `error_message` (error que vio el usuario).
 */
export function parseEmbeddedSignupMessage(origin: string, data: unknown): EmbeddedSignupEvent {
  if (!isFacebookOrigin(origin)) return { kind: "ignore" };
  let payload: unknown = data;
  if (typeof data === "string") {
    try {
      payload = JSON.parse(data);
    } catch {
      return { kind: "ignore" };
    }
  }
  const p = payload as { type?: unknown; event?: unknown; data?: Record<string, unknown> } | null;
  if (!p || p.type !== "WA_EMBEDDED_SIGNUP") return { kind: "ignore" };
  const event = typeof p.event === "string" ? p.event : "";
  const d = p.data ?? {};

  if (event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" || event === "FINISH") {
    const wabaId = str(d.waba_id);
    if (!wabaId) return { kind: "error", errorMessage: "Meta no devolvió la cuenta de WhatsApp (waba_id)." };
    return {
      kind: "finish",
      event,
      wabaId,
      phoneNumberId: str(d.phone_number_id),
      coexistence: event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    };
  }
  if (event === "CANCEL") {
    return { kind: "cancel", step: str(d.current_step), errorMessage: str(d.error_message) };
  }
  if (event === "ERROR") return { kind: "error", errorMessage: str(d.error_message) };
  return { kind: "ignore" };
}

/** Texto para quien abandonó o tuvo un error dentro del flujo de Meta. */
export function cancelMessage(e: { step: string | null; errorMessage: string | null }): string {
  if (e.errorMessage) return `Meta mostró un error: ${e.errorMessage}`;
  return e.step
    ? `Se cerró el flujo de Meta antes de terminar (paso ${e.step}). No se conectó nada.`
    : "Se cerró el flujo de Meta antes de terminar. No se conectó nada.";
}
