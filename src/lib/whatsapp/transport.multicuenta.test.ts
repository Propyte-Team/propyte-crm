import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deliverWhatsApp, deliverMetaTemplate } from "./transport";

// El número emisor no es cosmético: es la marca desde la que el cliente recibe
// el mensaje. Estos tests miran el WIRE (URL + Authorization), no el argumento,
// porque el bug original era justamente que el argumento nunca llegaba al wire.

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

describe("deliverWhatsApp — multicuenta", () => {
  it("sin sender usa el número global del env (una sola línea)", async () => {
    const fetchMock = okFetch();

    await deliverWhatsApp("+5219991112233", "hola");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`/${GLOBAL_PN}/messages`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${GLOBAL_TOKEN}`);
  });

  it("con sender sale por SU phoneNumberId y SU token, no por el global", async () => {
    const fetchMock = okFetch();

    await deliverWhatsApp("+5219991112233", "hola", undefined, {
      phoneNumberId: "PN_NATIVA",
      accessToken: "tok-nativa",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/PN_NATIVA/messages");
    expect(url).not.toContain(GLOBAL_PN);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-nativa");
  });

  it("el sender también manda cuando va media", async () => {
    const fetchMock = okFetch();

    await deliverWhatsApp(
      "+5219991112233",
      "mira",
      { url: "https://sb/a.jpg", type: "image" },
      { phoneNumberId: "PN_MARKET", accessToken: "tok-market" },
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/PN_MARKET/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-market");
  });

  it("las plantillas también respetan el sender", async () => {
    const fetchMock = okFetch();

    await deliverMetaTemplate("+5219991112233", "recordatorio", "es_MX", [], {
      phoneNumberId: "PN_NATIVA",
      accessToken: "tok-nativa",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/PN_NATIVA/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-nativa");
  });

  it("un sender explícito funciona aunque el env no tenga número global", async () => {
    delete process.env.META_WA_PHONE_NUMBER_ID;
    delete process.env.META_WA_ACCESS_TOKEN;
    process.env.WHATSAPP_PROVIDER = "meta_cloud";
    const fetchMock = okFetch();

    await deliverWhatsApp("+5219991112233", "hola", undefined, {
      phoneNumberId: "PN_SOLO",
      accessToken: "tok-solo",
    });

    expect(fetchMock.mock.calls[0][0]).toContain("/PN_SOLO/messages");
  });

  it("sin sender y sin env falla en vez de enviar a ciegas", async () => {
    delete process.env.META_WA_PHONE_NUMBER_ID;
    delete process.env.META_WA_ACCESS_TOKEN;
    process.env.WHATSAPP_PROVIDER = "meta_cloud";
    okFetch();

    await expect(deliverWhatsApp("+5219991112233", "hola")).rejects.toThrow(
      /META_WA_PHONE_NUMBER_ID/,
    );
  });
});
