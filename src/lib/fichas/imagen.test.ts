import { describe, it, expect, vi, afterEach } from "vitest";
import sharp from "sharp";
import { cabe, fotoComoDataUri, tituloCorto, urlDeFotoPermitida } from "./imagen";

// #887 — el flyer depende de convertir las fotos WebP del Hub a JPEG antes de dibujar: satori
// no lee WebP y sin esto el flyer salía sin fotos.

afterEach(() => vi.unstubAllGlobals());

function servir(buf: Buffer, tipo: string) {
  vi.stubGlobal("fetch", async () => new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": tipo } }));
}

describe("fotoComoDataUri", () => {
  it("convierte una WebP a JPEG del tamaño pedido", async () => {
    const webp = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#336699" } }).webp().toBuffer();
    servir(webp, "image/webp");
    const uri = await fotoComoDataUri("https://cdn.test/a.webp", 300, 200);
    expect(uri?.startsWith("data:image/jpeg;base64,")).toBe(true);
    const meta = await sharp(Buffer.from(uri!.split(",")[1], "base64")).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 300, 200]);
  });

  it("una foto que no baja se omite, no rompe", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 404 }));
    expect(await fotoComoDataUri("https://cdn.test/x.webp", 10, 10)).toBeNull();
    vi.stubGlobal("fetch", async () => {
      throw new Error("timeout");
    });
    expect(await fotoComoDataUri("https://cdn.test/x.webp", 10, 10)).toBeNull();
  });

  it("no va a direcciones que no sean https públicas", async () => {
    const fetchEspia = vi.fn();
    vi.stubGlobal("fetch", fetchEspia);
    expect(await fotoComoDataUri("http://cdn.test/a.jpg", 10, 10)).toBeNull();
    expect(await fotoComoDataUri("https://169.254.169.254/latest", 10, 10)).toBeNull();
    expect(fetchEspia).not.toHaveBeenCalled();
    expect(urlDeFotoPermitida("https://oaijxdpevakashxshhvm.supabase.co/storage/x.webp")).toBe(true);
  });
});

describe("textos del flyer", () => {
  it("quita el remate comercial del título", () => {
    expect(tituloCorto("The Landmark Playa del Carmen | Torre frente a la Quinta")).toBe("The Landmark Playa del Carmen");
    expect(tituloCorto("Torre Alba")).toBe("Torre Alba");
  });

  it("recorta con elipsis", () => {
    expect(cabe("abcdefghij", 5)).toBe("abcd…");
    expect(cabe("abc", 5)).toBe("abc");
    expect(cabe(null, 5)).toBe("");
  });
});
