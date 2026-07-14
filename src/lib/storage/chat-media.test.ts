import { describe, it, expect, vi, beforeEach } from "vitest";

const upload = vi.fn();
const createSignedUrls = vi.fn();
const createSignedUploadUrl = vi.fn();
const from = vi.fn(() => ({ upload, createSignedUrls, createSignedUploadUrl }));
let clientPresent = true;
vi.mock("@/lib/supabase", () => ({
  getSupabaseServiceClient: () => (clientPresent ? { storage: { from } } : null),
}));

import {
  isStoragePath,
  newChatMediaPath,
  uploadChatMedia,
  mirrorExternalMedia,
  signChatMediaUrls,
  createChatMediaUploadUrl,
} from "./chat-media";

beforeEach(() => {
  [upload, createSignedUrls, createSignedUploadUrl].forEach((m) => m.mockReset());
  clientPresent = true;
  vi.unstubAllGlobals();
});

describe("isStoragePath", () => {
  it("path del bucket → true; URL externa → false", () => {
    expect(isStoragePath("2026-07/abc.jpg")).toBe(true);
    expect(isStoragePath("https://cdn.fbsbx.com/x.jpg")).toBe(false);
    expect(isStoragePath("HTTP://X.COM/a")).toBe(false);
  });
});

describe("newChatMediaPath", () => {
  it("genera {yyyy-mm}/{uuid}.{ext} y sanea la extensión", () => {
    const p = newChatMediaPath("PdF!");
    expect(p).toMatch(/^\d{4}-\d{2}\/[0-9a-f-]{36}\.pdf$/);
  });
});

describe("uploadChatMedia", () => {
  it("sube con contentType y devuelve el path", async () => {
    upload.mockResolvedValue({ error: null });
    const path = await uploadChatMedia(Buffer.from("x"), "image/png");
    expect(path).toMatch(/\.png$/);
    expect(from).toHaveBeenCalledWith("chat-media");
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: "image/png" });
  });

  it("error de storage o sin cliente → null (nunca lanza)", async () => {
    upload.mockResolvedValue({ error: { message: "boom" } });
    expect(await uploadChatMedia(Buffer.from("x"), "image/png")).toBeNull();
    clientPresent = false;
    expect(await uploadChatMedia(Buffer.from("x"), "image/png")).toBeNull();
  });
});

describe("mirrorExternalMedia", () => {
  it("descarga y persiste; devuelve path + mime", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/jpeg", "content-length": "3" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    upload.mockResolvedValue({ error: null });
    const r = await mirrorExternalMedia("https://cdn.meta.com/x.jpg");
    expect(r?.mimeType).toBe("image/jpeg");
    expect(r?.path).toMatch(/\.jpg$/);
  });

  it("manda Bearer cuando hay authToken (media WhatsApp Cloud)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    await mirrorExternalMedia("https://lookaside.fbsbx.com/m", "TOK");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer TOK" });
  });

  it("HTTP !ok, body vacío o >25MB → null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await mirrorExternalMedia("https://x/1")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-length": String(30 * 1024 * 1024) }),
      arrayBuffer: async () => new ArrayBuffer(1),
    }));
    expect(await mirrorExternalMedia("https://x/2")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    expect(await mirrorExternalMedia("https://x/3")).toBeNull();
  });
});

describe("signChatMediaUrls", () => {
  it("firma solo paths del bucket (ignora URLs externas y duplicados)", async () => {
    createSignedUrls.mockResolvedValue({
      data: [{ path: "a.jpg", signedUrl: "https://sb/signed-a", error: null }],
      error: null,
    });
    const map = await signChatMediaUrls(["a.jpg", "a.jpg", "https://cdn/x.jpg"]);
    expect(createSignedUrls).toHaveBeenCalledWith(["a.jpg"], 60 * 60 * 24);
    expect(map).toEqual({ "a.jpg": "https://sb/signed-a" });
  });

  it("sin paths o error → {}", async () => {
    expect(await signChatMediaUrls([])).toEqual({});
    createSignedUrls.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await signChatMediaUrls(["a.jpg"])).toEqual({});
  });
});

describe("createChatMediaUploadUrl", () => {
  it("devuelve path + signedUrl + token", async () => {
    createSignedUploadUrl.mockResolvedValue({ data: { signedUrl: "https://sb/up", token: "T" }, error: null });
    const r = await createChatMediaUploadUrl("png");
    expect(r?.signedUrl).toBe("https://sb/up");
    expect(r?.token).toBe("T");
    expect(r?.path).toMatch(/\.png$/);
  });

  it("error → null", async () => {
    createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await createChatMediaUploadUrl("png")).toBeNull();
  });
});
