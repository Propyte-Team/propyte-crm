import { describe, it, expect, vi, beforeEach } from "vitest";
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
