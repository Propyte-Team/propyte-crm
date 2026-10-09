import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mirrorExternalMedia = vi.fn();
vi.mock("@/lib/storage/chat-media", () => ({
  mirrorExternalMedia: (...a: unknown[]) => mirrorExternalMedia(...a),
}));

import { resolveWaMediaToStorage } from "./media";

beforeEach(() => {
  mirrorExternalMedia.mockReset();
  vi.stubEnv("META_WA_ACCESS_TOKEN", "WA-TOKEN");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveWaMediaToStorage", () => {
  it("pide la URL temporal a Graph con Bearer y la espeja al bucket", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://lookaside.fbsbx.com/m/123" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    mirrorExternalMedia.mockResolvedValue({ path: "2026-07/x.jpg", mimeType: "image/jpeg" });

    const r = await resolveWaMediaToStorage("MEDIA-1");
    expect(r).toEqual({ path: "2026-07/x.jpg", mimeType: "image/jpeg" });
    expect(fetchMock.mock.calls[0][0]).toContain("/MEDIA-1");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer WA-TOKEN" });
    expect(mirrorExternalMedia).toHaveBeenCalledWith("https://lookaside.fbsbx.com/m/123", "WA-TOKEN");
  });

  it("sin token, sin id, HTTP !ok o sin url → null", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("META_WA_ACCESS_TOKEN", "");
    expect(await resolveWaMediaToStorage("M")).toBeNull();

    vi.stubEnv("META_WA_ACCESS_TOKEN", "T");
    expect(await resolveWaMediaToStorage("")).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await resolveWaMediaToStorage("M")).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await resolveWaMediaToStorage("M")).toBeNull();
  });

  it("fetch lanza → null (nunca rompe el webhook)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    expect(await resolveWaMediaToStorage("M")).toBeNull();
  });
});

// Marcas (2026-10-09, spec marcas-agente §4.3): el mensaje llega por el número de una
// cuenta y su media sólo se puede bajar con el token de ESA cuenta. Sin cuenta, el global.
describe("resolveWaMediaToStorage — token por cuenta", () => {
  function graphOk() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://lookaside.fbsbx.com/m/1" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    mirrorExternalMedia.mockResolvedValue({ path: "2026-10/x.jpg", mimeType: "image/jpeg" });
    return fetchMock;
  }

  it("con token de cuenta usa ESE Bearer (no el global) en Graph y en la descarga", async () => {
    const fetchMock = graphOk();

    const r = await resolveWaMediaToStorage("m1", "tok-cuenta");

    expect(r).toEqual({ path: "2026-10/x.jpg", mimeType: "image/jpeg" });
    expect(fetchMock.mock.calls[0][0]).toContain("/m1");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer tok-cuenta" });
    expect(mirrorExternalMedia).toHaveBeenCalledWith("https://lookaside.fbsbx.com/m/1", "tok-cuenta");
  });

  it("sin token de cuenta (undefined, null o vacío) usa META_WA_ACCESS_TOKEN, como hoy", async () => {
    for (const sinToken of [undefined, null, "", "   "]) {
      const fetchMock = graphOk();
      mirrorExternalMedia.mockClear();

      await resolveWaMediaToStorage("m1", sinToken);

      expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer WA-TOKEN" });
      expect(mirrorExternalMedia).toHaveBeenCalledWith("https://lookaside.fbsbx.com/m/1", "WA-TOKEN");
    }
  });

  it("el token de la cuenta se recorta", async () => {
    const fetchMock = graphOk();

    await resolveWaMediaToStorage("m1", "  tok-cuenta \n");

    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer tok-cuenta" });
  });

  it("con el token de cuenta NO hace falta el global: funciona aunque META_WA_ACCESS_TOKEN esté vacío", async () => {
    vi.stubEnv("META_WA_ACCESS_TOKEN", "");
    const fetchMock = graphOk();

    const r = await resolveWaMediaToStorage("m1", "tok-cuenta");

    expect(r).not.toBeNull();
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer tok-cuenta" });
  });

  it("ambos vacíos (cuenta y global) → null, sin llamar a Graph", async () => {
    vi.stubEnv("META_WA_ACCESS_TOKEN", "");
    const fetchMock = graphOk();

    expect(await resolveWaMediaToStorage("m1")).toBeNull();
    expect(await resolveWaMediaToStorage("m1", null)).toBeNull();
    expect(await resolveWaMediaToStorage("m1", "  ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
