// Partes puras de la coexistencia (2026-10-14): estado legible de la cuenta, mensajes de la sesión
// de Embedded Signup, opciones de FB.login, configuración del entorno y limpieza de secretos.
import { describe, it, expect, vi } from "vitest";
import { coexStatusOf, readCoexState } from "./status";
import {
  COEX_FEATURE_TYPE,
  cancelMessage,
  embeddedSignupLoginOptions,
  isFacebookOrigin,
  parseEmbeddedSignupMessage,
} from "./embedded-signup";
import { embeddedSignupAvailability, metaAppCredentials } from "./public-config";
import { exchangeCodeForToken, requestSmbAppData, scrubSecrets } from "./graph";

describe("coexStatusOf — conectado / desconectado / sincronización pendiente", () => {
  it("una cuenta manual (sin config.coex) no es de coexistencia", () => {
    expect(coexStatusOf({ phoneNumberId: "1" })).toBeNull();
    expect(coexStatusOf(null)).toBeNull();
    expect(readCoexState("texto")).toBeNull();
  });
  it("historial pidiéndose → sincronización pendiente con el avance", () => {
    expect(coexStatusOf({ coex: { accountState: "CONNECTED", subscribed: true, historySync: { state: "IN_PROGRESS", progress: 55.4, at: "x" } } }))
      .toMatchObject({ kind: "pending_sync", label: "Sincronizando historial (55%)" });
    expect(coexStatusOf({ coex: { accountState: "CONNECTED", subscribed: true } })).toMatchObject({ kind: "pending_sync" });
  });
  it("historial completo → conectado; rechazado → conectado con aviso", () => {
    expect(coexStatusOf({ coex: { accountState: "CONNECTED", historySync: { state: "COMPLETE", at: "x" } } })).toMatchObject({ kind: "connected", detail: null });
    expect(coexStatusOf({ coex: { accountState: "CONNECTED", historySync: { state: "DECLINED", at: "x" } } })?.detail).toMatch(/no compartió/);
  });
  it("desconectado por el negocio, con el motivo en palabras", () => {
    const s = coexStatusOf({ coex: { accountState: "DISCONNECTED", disconnection: { reason: "CHANGE_NUMBER" } } });
    expect(s).toMatchObject({ kind: "disconnected", label: "Desconectado por el negocio" });
    expect(s?.detail).toMatch(/cambió de número/);
  });
  it("cambio de teléfono → desconectado temporalmente", () => {
    expect(coexStatusOf({ coex: { accountState: "OFFBOARDED" } })).toMatchObject({ kind: "offboarded" });
  });
  it("sin suscripción a webhooks → se dice que no llegarán mensajes", () => {
    expect(coexStatusOf({ coex: { accountState: "CONNECTED", subscribed: false } })).toMatchObject({ kind: "not_subscribed" });
  });
});

describe("Embedded Signup v4 en el navegador", () => {
  it("FB.login lleva config_id, response_type code y la coexistencia en extras (sin `version`: la fija la configuración)", () => {
    const opts = embeddedSignupLoginOptions("cfg-1");
    expect(opts).toEqual({
      config_id: "cfg-1",
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
    });
    expect(COEX_FEATURE_TYPE).toBe("whatsapp_business_app_onboarding");
    expect(opts.extras).not.toHaveProperty("version");
  });

  it("solo se aceptan mensajes de facebook.com", () => {
    expect(isFacebookOrigin("https://www.facebook.com")).toBe(true);
    expect(isFacebookOrigin("https://facebook.com")).toBe(true);
    expect(isFacebookOrigin("https://evilfacebook.com")).toBe(false);
    expect(isFacebookOrigin("https://facebook.com.evil.io")).toBe(false);
    const data = JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: "1" } });
    expect(parseEmbeddedSignupMessage("https://evil.io", data)).toEqual({ kind: "ignore" });
  });

  it("fin de coexistencia: solo con waba_id (como el ejemplo de la doc)", () => {
    const data = JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: "524126980791429" }, version: 3 });
    expect(parseEmbeddedSignupMessage("https://www.facebook.com", data)).toEqual({
      kind: "finish",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      wabaId: "524126980791429",
      phoneNumberId: null,
      coexistence: true,
    });
  });

  it("fin con número nuevo (FINISH) → se reporta como no-coexistencia", () => {
    const data = { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "1", phone_number_id: "2" } };
    expect(parseEmbeddedSignupMessage("https://www.facebook.com", data)).toMatchObject({ kind: "finish", phoneNumberId: "2", coexistence: false });
  });

  it("abandono y error del usuario", () => {
    const cancel = parseEmbeddedSignupMessage("https://www.facebook.com", JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE_NUMBER_SETUP" } }));
    expect(cancel).toEqual({ kind: "cancel", step: "PHONE_NUMBER_SETUP", errorMessage: null });
    expect(cancelMessage(cancel as { step: string; errorMessage: null })).toContain("PHONE_NUMBER_SETUP");
    const err = parseEmbeddedSignupMessage("https://www.facebook.com", JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { error_message: "Nombre no válido" } }));
    expect(cancelMessage(err as { step: null; errorMessage: string })).toContain("Nombre no válido");
  });

  it("basura, otros tipos o JSON roto → ignorar", () => {
    expect(parseEmbeddedSignupMessage("https://www.facebook.com", "{no json")).toEqual({ kind: "ignore" });
    expect(parseEmbeddedSignupMessage("https://www.facebook.com", { type: "OTRO" })).toEqual({ kind: "ignore" });
    expect(parseEmbeddedSignupMessage("https://www.facebook.com", null)).toEqual({ kind: "ignore" });
  });
});

describe("configuración del entorno", () => {
  const full = { NEXT_PUBLIC_META_APP_ID: " 123 ", NEXT_PUBLIC_META_ES_CONFIG_ID: "cfg", META_WA_APP_SECRET: "sec" };
  it("con todo puesto → disponible, sin exponer el App Secret", () => {
    const a = embeddedSignupAvailability(full);
    expect(a).toEqual({ ok: true, config: { appId: "123", configId: "cfg", graphVersion: "v24.0" } });
    expect(JSON.stringify(a)).not.toContain("sec");
  });
  it("lo que falta se nombra (incluido el App Secret, sin el que no se puede canjear el código)", () => {
    expect(embeddedSignupAvailability({})).toEqual({
      ok: false,
      missing: ["NEXT_PUBLIC_META_APP_ID", "NEXT_PUBLIC_META_ES_CONFIG_ID", "META_WA_APP_SECRET"],
    });
    expect(embeddedSignupAvailability({ ...full, META_WA_APP_SECRET: "  " })).toEqual({ ok: false, missing: ["META_WA_APP_SECRET"] });
  });
  it("credenciales de la app para el canje", () => {
    expect(metaAppCredentials(full)).toEqual({ appId: "123", appSecret: "sec" });
    expect(metaAppCredentials({ NEXT_PUBLIC_META_APP_ID: "1" })).toBeNull();
  });
});

describe("Graph — secretos y fallos", () => {
  it("scrubSecrets tapa cada secreto y recorta", () => {
    expect(scrubSecrets("token EAAB123456 y code AQB999999", ["EAAB123456", "AQB999999"])).toBe("token [oculto] y code [oculto]");
    expect(scrubSecrets("x".repeat(400), [])).toHaveLength(300);
  });

  it("el canje nunca devuelve el secreto ni el código en el error", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 100, message: "Invalid code AQBcodigo123 for client_secret SECRETO" } }),
    })) as unknown as typeof fetch;
    const r = await exchangeCodeForToken({ code: "AQBcodigo123", appId: "1", appSecret: "SECRETO" }, { fetchImpl });
    expect(r).toMatchObject({ ok: false, kind: "graph", code: 100 });
    expect(JSON.stringify(r)).not.toContain("AQBcodigo123");
    expect(JSON.stringify(r)).not.toContain("SECRETO");
  });

  it("canje sin access_token en la respuesta → fallo claro", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await exchangeCodeForToken({ code: "c".repeat(12), appId: "1", appSecret: "s" }, { fetchImpl })).toMatchObject({ ok: false });
  });

  it("timeout → fallo de red, nunca lanza", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    expect(await requestSmbAppData("1", "tok", "history", { fetchImpl })).toEqual({ ok: false, kind: "network", error: "Meta no respondió a tiempo" });
  });

  it("smb_app_data: POST con messaging_product y sync_type, token en la cabecera", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ request_id: "r1" }) })) as unknown as typeof fetch;
    expect(await requestSmbAppData("106540352242922", "tok", "smb_app_state_sync", { fetchImpl })).toEqual({ ok: true, requestId: "r1" });
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v24.0/106540352242922/smb_app_data");
    expect(init).toMatchObject({ method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" } });
    expect(JSON.parse(String(init.body))).toEqual({ messaging_product: "whatsapp", sync_type: "smb_app_state_sync" });
  });
});
