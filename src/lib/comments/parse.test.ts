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
    expect(parseCommentWebhook(igComment).comments).toEqual([
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
    expect(parseCommentWebhook(fbComment).comments).toEqual([
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
    expect(parseCommentWebhook(nested).comments[0].isNested).toBe(true);
  });

  it("Instagram: parent_id presente es anidado", () => {
    const nested = structuredClone(igComment) as typeof igComment & {
      entry: Array<{ changes: Array<{ value: Record<string, unknown> }> }>;
    };
    nested.entry[0].changes[0].value.parent_id = "IGCOMMENT-PADRE";
    expect(parseCommentWebhook(nested).comments[0].isNested).toBe(true);
  });

  it("ignora verbos que no son 'add' (ediciones y borrados): cero comentarios y cero descartes", () => {
    for (const verb of ["edited", "remove", "hide"]) {
      const other = structuredClone(fbComment);
      other.entry[0].changes[0].value.verb = verb;
      const result = parseCommentWebhook(other);
      expect(result.comments, verb).toEqual([]);
      expect(result.discarded, verb).toEqual([]);
    }
  });

  it("ignora items de feed que no son comentarios (item !== 'comment'): cero y cero", () => {
    const post = structuredClone(fbComment);
    post.entry[0].changes[0].value.item = "reaction";
    const result = parseCommentWebhook(post);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([]);
  });

  it("field desconocido (reactions) no es un comentario: cero y cero", () => {
    const other = structuredClone(fbComment);
    other.entry[0].changes[0].field = "reactions";
    const result = parseCommentWebhook(other);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([]);
  });

  it("ignora el payload de mensajes (entry[].messaging) sin lanzar y sin descartes", () => {
    const dm = {
      object: "instagram",
      entry: [{ id: "1", messaging: [{ sender: { id: "X" }, message: { mid: "m", text: "hola" } }] }],
    };
    const result = parseCommentWebhook(dm);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([]);
  });

  it("comentario de Facebook sin texto (solo sticker) se descarta con reason 'sin-texto'", () => {
    const sinTexto = structuredClone(fbComment);
    delete (sinTexto.entry[0].changes[0].value as Record<string, unknown>).message;
    const result = parseCommentWebhook(sinTexto);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([
      {
        platform: "FACEBOOK",
        accountId: "PAGE-1",
        externalCommentId: "PAGE-1_COMMENT-1",
        reason: "sin-texto",
      },
    ]);
  });

  it("objetos desconocidos y basura devuelven vacío sin descartes", () => {
    expect(parseCommentWebhook({ object: "whatsapp_business_account", entry: [] })).toEqual({
      comments: [],
      discarded: [],
    });
    expect(parseCommentWebhook(null)).toEqual({ comments: [], discarded: [] });
    expect(parseCommentWebhook({})).toEqual({ comments: [], discarded: [] });
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
    expect(parseCommentWebhook(dos).comments.map((c) => c.externalCommentId)).toEqual([
      "IGCOMMENT-1",
      "IGCOMMENT-2",
    ]);
  });

  // --- Descartes: era un comentario y le faltó un campo obligatorio ---
  // Caso real de producción: Meta omite `from` cuando el comentarista bloqueó
  // la Página, cuando falta `pages_read_engagement`, o cuando la cuenta fue
  // borrada. Sin `discarded` ese comentario se perdía sin dejar rastro.

  it("Facebook sin 'from' se descarta con reason 'sin-autor'", () => {
    const sinAutor = structuredClone(fbComment);
    delete (sinAutor.entry[0].changes[0].value as Record<string, unknown>).from;
    const result = parseCommentWebhook(sinAutor);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([
      {
        platform: "FACEBOOK",
        accountId: "PAGE-1",
        externalCommentId: "PAGE-1_COMMENT-1",
        reason: "sin-autor",
      },
    ]);
  });

  it("Instagram sin 'from' se descarta con reason 'sin-autor'", () => {
    const sinAutor = structuredClone(igComment);
    delete (sinAutor.entry[0].changes[0].value as Record<string, unknown>).from;
    const result = parseCommentWebhook(sinAutor);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([
      {
        platform: "INSTAGRAM",
        accountId: "17841453458089530",
        externalCommentId: "IGCOMMENT-1",
        reason: "sin-autor",
      },
    ]);
  });

  it("Instagram sin 'media' se descarta con reason 'sin-publicacion'", () => {
    const sinMedia = structuredClone(igComment);
    delete (sinMedia.entry[0].changes[0].value as Record<string, unknown>).media;
    const result = parseCommentWebhook(sinMedia);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([
      {
        platform: "INSTAGRAM",
        accountId: "17841453458089530",
        externalCommentId: "IGCOMMENT-1",
        reason: "sin-publicacion",
      },
    ]);
  });

  it("Facebook sin 'comment_id' se descarta con reason 'sin-id' y externalCommentId null", () => {
    const sinId = structuredClone(fbComment);
    delete (sinId.entry[0].changes[0].value as Record<string, unknown>).comment_id;
    const result = parseCommentWebhook(sinId);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([
      {
        platform: "FACEBOOK",
        accountId: "PAGE-1",
        externalCommentId: null,
        reason: "sin-id",
      },
    ]);
  });

  it("Instagram sin 'id' se descarta con reason 'sin-id' y externalCommentId null", () => {
    const sinId = structuredClone(igComment);
    delete (sinId.entry[0].changes[0].value as Record<string, unknown>).id;
    const result = parseCommentWebhook(sinId);
    expect(result.comments).toEqual([]);
    expect(result.discarded).toEqual([
      {
        platform: "INSTAGRAM",
        accountId: "17841453458089530",
        externalCommentId: null,
        reason: "sin-id",
      },
    ]);
  });

  it("precedencia: falta 'from' y 'message' reporta 'sin-autor', no 'sin-texto'", () => {
    const sinAmbos = structuredClone(fbComment);
    const value = sinAmbos.entry[0].changes[0].value as Record<string, unknown>;
    delete value.from;
    delete value.message;
    const result = parseCommentWebhook(sinAmbos);
    expect(result.discarded).toEqual([
      {
        platform: "FACEBOOK",
        accountId: "PAGE-1",
        externalCommentId: "PAGE-1_COMMENT-1",
        reason: "sin-autor",
      },
    ]);
  });

  it("un batch con un comentario válido y otro sin 'from' devuelve uno en comments y uno en discarded", () => {
    const batch = structuredClone(igComment);
    batch.entry[0].changes.push({
      field: "comments",
      value: {
        id: "IGCOMMENT-2",
        text: "precio?",
        from: { id: "IGSID-2", username: "ana" },
        media: { id: "MEDIA-1", media_product_type: "FEED" },
      },
    });
    delete (batch.entry[0].changes[1].value as Record<string, unknown>).from;

    const result = parseCommentWebhook(batch);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].externalCommentId).toBe("IGCOMMENT-1");
    expect(result.discarded).toEqual([
      {
        platform: "INSTAGRAM",
        accountId: "17841453458089530",
        externalCommentId: "IGCOMMENT-2",
        reason: "sin-autor",
      },
    ]);
  });
});
