import { describe, it, expect } from "vitest";
import { parseCommentWebhook } from "./parse";

const igComment = {
  object: "instagram",
  entry: [
    {
      id: "17841453458089530",
      time: 1754300000,
      changes: [
        {
          field: "comments",
          value: {
            id: "IGCOMMENT-1",
            text: "info porfa",
            from: { id: "IGSID-1", username: "luisf" },
            media: { id: "MEDIA-1", media_product_type: "FEED" },
          },
        },
      ],
    },
  ],
};

const fbComment = {
  object: "page",
  entry: [
    {
      id: "PAGE-1",
      time: 1754300000,
      changes: [
        {
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: "PAGE-1_COMMENT-1",
            post_id: "PAGE-1_POST-1",
            parent_id: "PAGE-1_POST-1",
            from: { id: "ASID-1", name: "Luis Flores" },
            message: "info",
            created_time: 1754300000,
          },
        },
      ],
    },
  ],
};

describe("parseCommentWebhook", () => {
  it("extrae el comentario de Instagram", () => {
    expect(parseCommentWebhook(igComment)).toEqual([
      {
        platform: "INSTAGRAM",
        accountId: "17841453458089530",
        externalCommentId: "IGCOMMENT-1",
        postId: "MEDIA-1",
        authorId: "IGSID-1",
        authorHandle: "luisf",
        text: "info porfa",
        isNested: false,
      },
    ]);
  });

  it("extrae el comentario de Facebook y usa from.name como handle", () => {
    expect(parseCommentWebhook(fbComment)).toEqual([
      {
        platform: "FACEBOOK",
        accountId: "PAGE-1",
        externalCommentId: "PAGE-1_COMMENT-1",
        postId: "PAGE-1_POST-1",
        authorId: "ASID-1",
        authorHandle: "Luis Flores",
        text: "info",
        isNested: false,
      },
    ]);
  });

  it("Facebook: parent_id == post_id es primer nivel, distinto es anidado", () => {
    const nested = structuredClone(fbComment);
    nested.entry[0].changes[0].value.parent_id = "PAGE-1_COMMENT-OTRO";
    expect(parseCommentWebhook(nested)[0].isNested).toBe(true);
  });

  it("Instagram: parent_id presente es anidado", () => {
    const nested = structuredClone(igComment) as typeof igComment & {
      entry: Array<{ changes: Array<{ value: Record<string, unknown> }> }>;
    };
    nested.entry[0].changes[0].value.parent_id = "IGCOMMENT-PADRE";
    expect(parseCommentWebhook(nested)[0].isNested).toBe(true);
  });

  it("ignora verbos que no son 'add' (ediciones y borrados)", () => {
    for (const verb of ["edited", "remove", "hide"]) {
      const other = structuredClone(fbComment);
      other.entry[0].changes[0].value.verb = verb;
      expect(parseCommentWebhook(other), verb).toEqual([]);
    }
  });

  it("ignora items de feed que no son comentarios", () => {
    const post = structuredClone(fbComment);
    post.entry[0].changes[0].value.item = "reaction";
    expect(parseCommentWebhook(post)).toEqual([]);
  });

  it("ignora el payload de mensajes (entry[].messaging) sin lanzar", () => {
    const dm = {
      object: "instagram",
      entry: [{ id: "1", messaging: [{ sender: { id: "X" }, message: { mid: "m", text: "hola" } }] }],
    };
    expect(parseCommentWebhook(dm)).toEqual([]);
  });

  it("comentario sin texto (solo sticker) se descarta", () => {
    const sinTexto = structuredClone(fbComment);
    delete (sinTexto.entry[0].changes[0].value as Record<string, unknown>).message;
    expect(parseCommentWebhook(sinTexto)).toEqual([]);
  });

  it("objetos desconocidos y basura devuelven vacío", () => {
    expect(parseCommentWebhook({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
    expect(parseCommentWebhook(null)).toEqual([]);
    expect(parseCommentWebhook({})).toEqual([]);
  });

  it("procesa varios cambios en un solo entry", () => {
    const dos = structuredClone(igComment);
    dos.entry[0].changes.push({
      field: "comments",
      value: {
        id: "IGCOMMENT-2",
        text: "precio?",
        from: { id: "IGSID-2", username: "ana" },
        media: { id: "MEDIA-1", media_product_type: "FEED" },
      },
    });
    expect(parseCommentWebhook(dos).map((c) => c.externalCommentId)).toEqual([
      "IGCOMMENT-1",
      "IGCOMMENT-2",
    ]);
  });
});
