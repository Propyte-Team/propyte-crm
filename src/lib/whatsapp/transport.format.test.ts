import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deliverWhatsApp } from "./transport";

// deliverWhatsApp es el embudo de red de TODO WhatsApp saliente (ambos drivers):
// verifica que el markdown se normaliza a formato WhatsApp justo antes del wire.

beforeEach(() => {
  process.env.WHATSAPP_PROVIDER = "meta_cloud";
  process.env.META_WA_PHONE_NUMBER_ID = "123456";
  process.env.META_WA_ACCESS_TOKEN = "test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHATSAPP_PROVIDER;
  delete process.env.META_WA_PHONE_NUMBER_ID;
  delete process.env.META_WA_ACCESS_TOKEN;
});

describe("deliverWhatsApp — formato WhatsApp en el wire", () => {
  it("convierte **negrita** markdown antes de entregar por Meta Cloud", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.TEST1" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await deliverWhatsApp("+5219991112233", "Agendo para **mañana a las 7 AM** — un asesor te contacta.");

    expect(result).toEqual({ externalId: "wamid.TEST1", status: "SENT" });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload.text.body).toBe("Agendo para *mañana a las 7 AM* — un asesor te contacta.");
  });

  it("texto ya en formato WhatsApp pasa intacto", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.TEST2" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await deliverWhatsApp("+5219991112233", "Confirmado *mañana* a las 7, _puntual_ 🙂");

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload.text.body).toBe("Confirmado *mañana* a las 7, _puntual_ 🙂");
  });
});

describe("deliverWhatsApp — media (Meta Cloud)", () => {
  it("imagen con caption → payload type image + link + caption", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.MEDIA1" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await deliverWhatsApp("+5219991112233", "checa esta", { url: "https://sb/signed.jpg", type: "image" });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload.type).toBe("image");
    expect(payload.image).toEqual({ link: "https://sb/signed.jpg", caption: "checa esta" });
    expect(payload.text).toBeUndefined();
  });

  it("documento lleva filename; sticker NO lleva caption", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.MEDIA2" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await deliverWhatsApp("+5219991112233", "brochure", { url: "https://sb/d.pdf", type: "document", filename: "brochure.pdf" });
    let payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload.document).toEqual({ link: "https://sb/d.pdf", caption: "brochure", filename: "brochure.pdf" });

    await deliverWhatsApp("+5219991112233", "ignorado", { url: "https://sb/s.webp", type: "sticker" });
    payload = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(payload.type).toBe("sticker");
    expect(payload.sticker).toEqual({ link: "https://sb/s.webp" });
  });
});
