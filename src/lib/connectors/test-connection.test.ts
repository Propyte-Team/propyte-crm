import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { testConnection } from "./test-connection";

beforeEach(() => { vi.restoreAllMocks(); });

describe("testConnection · meta", () => {
  it("ok cuando la Graph API devuelve el nombre de la página", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ name: "Propyte BR", id: "123" }), { status: 200 })
    );
    const r = await testConnection("META", { pageId: "123", pageAccessToken: "t", appSecret: "s", verifyToken: "v" });
    expect(r.ok).toBe(true);
    expect(r.accountName).toBe("Propyte BR");
  });
  it("falla con token inválido", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid OAuth token" } }), { status: 400 })
    );
    const r = await testConnection("META", { pageId: "123", pageAccessToken: "bad", appSecret: "s", verifyToken: "v" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("Invalid OAuth");
  });
  it("devuelve ok:false si fetch lanza (fallo de red)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network failure"));
    const r = await testConnection("META", { pageId: "1", pageAccessToken: "t", appSecret: "s", verifyToken: "v" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("Network failure");
  });
});

describe("testConnection · provider push-only", () => {
  it("rechaza YouTube (no soporta pull)", async () => {
    const r = await testConnection("YOUTUBE", {});
    expect(r.ok).toBe(false);
  });
});

describe("testConnection · instagram", () => {
  it("resuelve igual que META (mismo Graph API)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ name: "Nativa IG", id: "9" }), { status: 200 })
    );
    const r = await testConnection("INSTAGRAM", { pageId: "9", pageAccessToken: "t", appSecret: "s", verifyToken: "v" });
    expect(r.ok).toBe(true);
    expect(r.accountName).toBe("Nativa IG");
  });
});

// WhatsApp (2026-10-09): la prueba valida el número y el token contra Graph, igual que
// las demás plataformas. Antes testKind era "none" y el wizard nunca dejaba guardar.
describe("testConnection · whatsapp", () => {
  let fetchMock: MockInstance<typeof fetch>;
  beforeEach(() => { fetchMock = vi.spyOn(globalThis, "fetch"); });

  it("WHATSAPP: valida el número contra Graph y devuelve nombre y teléfono", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ verified_name: "Yaxnáh Caucel", display_phone_number: "+52 999 368 4863", id: "123" }), { status: 200 }));
    const r = await testConnection("WHATSAPP", { phoneNumberId: "123", accessToken: "tok-test" });
    expect(r).toEqual({ ok: true, accountName: "Yaxnáh Caucel · +52 999 368 4863" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v24.0/123?fields=display_phone_number,verified_name",
      { headers: { Authorization: "Bearer tok-test" } },
    );
  });
  it("WHATSAPP: token inválido → ok:false con el mensaje de Graph", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), { status: 401 }));
    expect(await testConnection("WHATSAPP", { phoneNumberId: "123", accessToken: "x" })).toEqual({ ok: false, detail: "Invalid OAuth access token" });
  });
  it("WHATSAPP: faltan datos → ok:false sin llamar a Graph", async () => {
    expect(await testConnection("WHATSAPP", { phoneNumberId: "", accessToken: "" })).toEqual({ ok: false, detail: "Faltan Phone Number ID o Access Token." });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
