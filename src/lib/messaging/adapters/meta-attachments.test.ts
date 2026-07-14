import { describe, it, expect } from "vitest";
import { expandMetaMessage } from "./meta-attachments";

const base = { channel: "MESSENGER" as const, senderId: "PSID-1", accountId: "PAGE-1" };

describe("expandMetaMessage", () => {
  it("texto puro → 1 mensaje sin media (shape retrocompatible)", () => {
    expect(expandMetaMessage(base, { mid: "m1", text: "hola" })).toEqual([
      { channel: "MESSENGER", senderId: "PSID-1", accountId: "PAGE-1", externalMessageId: "m1", text: "hola", mediaUrl: null },
    ]);
  });

  it("imagen sola → 1 mensaje con mediaType y placeholder de body", () => {
    const [msg] = expandMetaMessage(base, {
      mid: "m2",
      attachments: [{ type: "image", payload: { url: "https://cdn/x.jpg" } }],
    });
    expect(msg).toMatchObject({ externalMessageId: "m2", text: "[Imagen]", mediaUrl: "https://cdn/x.jpg", mediaType: "image" });
  });

  it("texto + imagen → el texto va en el mensaje del adjunto", () => {
    const out = expandMetaMessage(base, {
      mid: "m3",
      text: "mira esta",
      attachments: [{ type: "image", payload: { url: "https://cdn/x.jpg" } }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: "mira esta", mediaType: "image" });
  });

  it("múltiples adjuntos → 1 mensaje c/u, mid con sufijo #i para dedup", () => {
    const out = expandMetaMessage(base, {
      mid: "m4",
      attachments: [
        { type: "image", payload: { url: "https://cdn/1.jpg" } },
        { type: "image", payload: { url: "https://cdn/2.jpg" } },
        { type: "file", payload: { url: "https://cdn/doc.pdf" } },
      ],
    });
    expect(out.map((m) => m.externalMessageId)).toEqual(["m4", "m4#1", "m4#2"]);
    expect(out.map((m) => m.mediaType)).toEqual(["image", "image", "document"]);
    expect(out[2].text).toBe("[Documento]");
  });

  it("sticker y gif se detectan", () => {
    const out = expandMetaMessage(base, {
      mid: "m5",
      attachments: [
        { type: "image", payload: { url: "https://cdn/s.png", sticker_id: 33 } },
        { type: "image", payload: { url: "https://cdn/a.gif" } },
      ],
    });
    expect(out.map((m) => m.mediaType)).toEqual(["sticker", "gif"]);
    expect(out[0].text).toBe("[Sticker]");
  });

  it("share sin texto → el link como texto, sin media", () => {
    const out = expandMetaMessage(base, {
      mid: "m6",
      attachments: [{ type: "share", payload: { url: "https://fb.com/post/1" } }],
    });
    expect(out).toEqual([
      { ...base, externalMessageId: "m6", text: "https://fb.com/post/1", mediaUrl: null },
    ]);
  });

  it("adjunto sin url ni tipo → placeholder [Adjunto]", () => {
    const out = expandMetaMessage(base, { mid: "m7", attachments: [{}] });
    expect(out[0].text).toBe("[Adjunto]");
    expect(out[0].mediaUrl).toBeNull();
  });
});
