import { describe, it, expect } from "vitest";
import {
  isMediaAllowed,
  mediaTypeFromMime,
  mediaTypeFromAttachment,
  mediaTypeFromWaType,
  graphAttachmentType,
  waMessageType,
  mediaPlaceholderBody,
} from "./media";

describe("isMediaAllowed — matriz canal×tipo", () => {
  it("IG no permite documentos (límite API Meta); Messenger sí", () => {
    expect(isMediaAllowed("INSTAGRAM", "document")).toBe(false);
    expect(isMediaAllowed("MESSENGER", "document")).toBe(true);
  });

  it("WA no permite gif; sí sticker; MSG/IG sí gif", () => {
    expect(isMediaAllowed("WHATSAPP", "gif")).toBe(false);
    expect(isMediaAllowed("WHATSAPP", "sticker")).toBe(true);
    expect(isMediaAllowed("MESSENGER", "gif")).toBe(true);
    expect(isMediaAllowed("INSTAGRAM", "gif")).toBe(true);
  });

  it("aplica límites de tamaño (imagen WA 5MB)", () => {
    expect(isMediaAllowed("WHATSAPP", "image", 4 * 1024 * 1024)).toBe(true);
    expect(isMediaAllowed("WHATSAPP", "image", 6 * 1024 * 1024)).toBe(false);
    expect(isMediaAllowed("MESSENGER", "image", 6 * 1024 * 1024)).toBe(true);
  });

  it("canal desconocido → false", () => {
    expect(isMediaAllowed("SMS", "image")).toBe(false);
  });
});

describe("mediaTypeFromMime", () => {
  it("gif, webp (sticker solo en WA), image, audio, video, document", () => {
    expect(mediaTypeFromMime("image/gif")).toBe("gif");
    expect(mediaTypeFromMime("image/webp", "WHATSAPP")).toBe("sticker");
    expect(mediaTypeFromMime("image/webp", "MESSENGER")).toBe("image");
    expect(mediaTypeFromMime("image/jpeg")).toBe("image");
    expect(mediaTypeFromMime("audio/ogg")).toBe("audio");
    expect(mediaTypeFromMime("video/mp4")).toBe("video");
    expect(mediaTypeFromMime("application/pdf")).toBe("document");
  });
});

describe("mediaTypeFromAttachment (webhook IG/MSG)", () => {
  it("image con sticker_id → sticker; url .gif → gif; file → document", () => {
    expect(mediaTypeFromAttachment({ type: "image", payload: { sticker_id: 1, url: "https://cdn/x.png" } })).toBe("sticker");
    expect(mediaTypeFromAttachment({ type: "image", payload: { url: "https://cdn/anim.gif?x=1" } })).toBe("gif");
    expect(mediaTypeFromAttachment({ type: "image", payload: { url: "https://cdn/x.jpg" } })).toBe("image");
    expect(mediaTypeFromAttachment({ type: "file", payload: { url: "https://cdn/doc.pdf" } })).toBe("document");
    expect(mediaTypeFromAttachment({ type: "audio", payload: {} })).toBe("audio");
  });

  it("share/fallback/desconocido → null (se trata como texto)", () => {
    expect(mediaTypeFromAttachment({ type: "share", payload: { url: "https://fb.com/post" } })).toBeNull();
    expect(mediaTypeFromAttachment({})).toBeNull();
  });
});

describe("mapeos de envío", () => {
  it("mediaTypeFromWaType cubre los 5 tipos y null para text", () => {
    expect(mediaTypeFromWaType("sticker")).toBe("sticker");
    expect(mediaTypeFromWaType("document")).toBe("document");
    expect(mediaTypeFromWaType("text")).toBeNull();
  });

  it("graphAttachmentType: gif/sticker → image; document → file", () => {
    expect(graphAttachmentType("gif")).toBe("image");
    expect(graphAttachmentType("sticker")).toBe("image");
    expect(graphAttachmentType("document")).toBe("file");
    expect(graphAttachmentType("audio")).toBe("audio");
  });

  it("waMessageType: gif → image; resto directo", () => {
    expect(waMessageType("gif")).toBe("image");
    expect(waMessageType("sticker")).toBe("sticker");
  });
});

describe("mediaPlaceholderBody", () => {
  it("documento con filename lo incluye; resto etiqueta fija", () => {
    expect(mediaPlaceholderBody("document", "brochure.pdf")).toBe("[Documento: brochure.pdf]");
    expect(mediaPlaceholderBody("image")).toBe("[Imagen]");
    expect(mediaPlaceholderBody("sticker")).toBe("[Sticker]");
  });
});
