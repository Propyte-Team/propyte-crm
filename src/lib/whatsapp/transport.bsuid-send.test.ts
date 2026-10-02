import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deliverWhatsApp, deliverMetaTemplate } from "./transport";

// #829 — enviar por BSUID cuando no hay teléfono real, y nunca al revés. El
// teléfono manda SIEMPRE que exista, aunque también haya BSUID guardado: es lo
// que mantiene viva la ventana de 30 días y lo que hace que Meta lo siga
// incluyendo en los webhooks (#826/#827). Se mira el WIRE (el body real que
// viaja a Meta), no el argumento — el riesgo es mandar `to` y `recipient` juntos
// o el que no toca, y eso solo se ve en lo que de verdad sale por la red.

const GLOBAL_PN = "123456";
const GLOBAL_TOKEN = "token-global";

function okFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ messages: [{ id: "wamid.OK" }] }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function erroredFetch(code: number, message: string) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: { code, message } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

beforeEach(() => {
  process.env.WHATSAPP_PROVIDER = "meta_cloud";
  process.env.META_WA_PHONE_NUMBER_ID = GLOBAL_PN;
  process.env.META_WA_ACCESS_TOKEN = GLOBAL_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHATSAPP_PROVIDER;
  delete process.env.META_WA_PHONE_NUMBER_ID;
  delete process.env.META_WA_ACCESS_TOKEN;
});

describe("deliverWhatsApp — #829 destinatario por teléfono o por BSUID", () => {
  it("con teléfono: el body manda `to`, nunca `recipient` (no-regresión)", async () => {
    const fetchMock = okFetch();
    await deliverWhatsApp("+5219991112233", "hola");
    const body = bodyOf(fetchMock);
    expect(body.to).toBe("5219991112233");
    expect(body.recipient).toBeUndefined();
  });

  it("sin teléfono (null) pero con BSUID: el body manda `recipient`, nunca `to`", async () => {
    const fetchMock = okFetch();
    await deliverWhatsApp(null, "hola", undefined, null, "MX.13491208655302741918");
    const body = bodyOf(fetchMock);
    expect(body.recipient).toBe("MX.13491208655302741918");
    expect(body.to).toBeUndefined();
  });

  it("el BSUID se manda COMPLETO — país, punto y alfanuméricos, sin recortar", async () => {
    const fetchMock = okFetch();
    await deliverWhatsApp(null, "hola", undefined, null, "US.13491208655302741918");
    expect(bodyOf(fetchMock).recipient).toBe("US.13491208655302741918");
  });

  it("sin teléfono y sin BSUID: falla ANTES de llamar a la red — nunca manda un body vacío de destinatario", async () => {
    const fetchMock = okFetch();
    await expect(deliverWhatsApp(null, "hola")).rejects.toThrow(/no hay teléfono ni BSUID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("131062 (BSUID no soportado para este tipo de mensaje) se distingue del error genérico", async () => {
    erroredFetch(131062, "Recipient type not supported");
    await expect(
      deliverWhatsApp(null, "hola", undefined, null, "MX.sin-telefono"),
    ).rejects.toThrow(/no acepta destinatario por BSUID/);
  });
});

describe("deliverMetaTemplate — #829 destinatario por teléfono o por BSUID", () => {
  it("con teléfono: el body manda `to`", async () => {
    const fetchMock = okFetch();
    await deliverMetaTemplate("+5219991112233", "recordatorio", "es_MX", []);
    const body = bodyOf(fetchMock);
    expect(body.to).toBe("5219991112233");
    expect(body.recipient).toBeUndefined();
  });

  it("sin teléfono, con BSUID: el body manda `recipient`", async () => {
    const fetchMock = okFetch();
    await deliverMetaTemplate(null, "recordatorio", "es_MX", [], null, "MX.sin-telefono");
    const body = bodyOf(fetchMock);
    expect(body.recipient).toBe("MX.sin-telefono");
    expect(body.to).toBeUndefined();
  });

  it("131062 en una plantilla (autenticación one-tap/zero-tap) se distingue del genérico", async () => {
    erroredFetch(131062, "Recipient type not supported");
    await expect(
      deliverMetaTemplate(null, "auth_otp", "es_MX", [], null, "MX.sin-telefono"),
    ).rejects.toThrow(/no acepta destinatario por BSUID/);
  });
});
