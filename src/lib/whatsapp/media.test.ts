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
