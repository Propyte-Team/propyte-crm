import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingComment } from "./parse";

const ruleFindMany = vi.fn();
const logFindUnique = vi.fn();
const logFindFirst = vi.fn();
const logCreate = vi.fn();
const logUpdate = vi.fn();
const logCount = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    commentRule: { findMany: (...a: unknown[]) => ruleFindMany(...a) },
    commentRuleLog: {
      findUnique: (...a: unknown[]) => logFindUnique(...a),
      findFirst: (...a: unknown[]) => logFindFirst(...a),
      create: (...a: unknown[]) => logCreate(...a),
      update: (...a: unknown[]) => logUpdate(...a),
      count: (...a: unknown[]) => logCount(...a),
    },
  },
}));

const resolveByIg = vi.fn();
const resolveByPage = vi.fn();
const getToken = vi.fn();
vi.mock("@/lib/messaging/social-accounts", () => ({
  resolveConnectorByIgBusinessId: (...a: unknown[]) => resolveByIg(...a),
  resolveConnectorByPageId: (...a: unknown[]) => resolveByPage(...a),
  getSocialPageToken: (...a: unknown[]) => getToken(...a),
}));

const replyToComment = vi.fn();
const sendPrivateReply = vi.fn();
vi.mock("./graph", () => ({
  replyToComment: (...a: unknown[]) => replyToComment(...a),
  sendPrivateReply: (...a: unknown[]) => sendPrivateReply(...a),
}));

const persistOpener = vi.fn();
vi.mock("./link-comment-origin", () => ({
  persistOpenerForKnownContact: (...a: unknown[]) => persistOpener(...a),
}));

import { handleComment } from "./handle-comment";

const IG_CONNECTOR = {
  id: "conn-ig",
  provider: "INSTAGRAM",
  config: { igBusinessId: "17841", pageId: "PAGE-1" },
};

const RULE = {
  id: "rule-1",
  connectorId: "conn-ig",
  priority: 100,
  phrases: ["info"],
  postFilter: [],
  publicReplies: ["Te escribo al DM 📩", "Ya te mandé privado 📩"],
  dmTemplate: "Hola {{usuario}}, aquí va la info.",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function comment(over: Partial<IncomingComment> = {}): IncomingComment {
  return {
    platform: "INSTAGRAM",
    accountId: "17841",
    externalCommentId: "IGCOMMENT-1",
    postId: "MEDIA-1",
    authorId: "IGSID-1",
    authorHandle: "luisf",
    text: "info porfa",
    isNested: false,
    ...over,
  };
}

beforeEach(() => {
  for (const m of [
    ruleFindMany, logFindUnique, logFindFirst, logCreate, logUpdate, logCount,
    resolveByIg, resolveByPage, getToken, replyToComment, sendPrivateReply, persistOpener,
  ]) m.mockReset();

  resolveByIg.mockResolvedValue(IG_CONNECTOR);
  resolveByPage.mockResolvedValue(null);
  getToken.mockReturnValue("TOKEN");
  ruleFindMany.mockResolvedValue([RULE]);
  logFindUnique.mockResolvedValue(null);
  logFindFirst.mockResolvedValue(null);
  logCount.mockResolvedValue(0);
  logCreate.mockResolvedValue({ id: "log-1" });
  logUpdate.mockResolvedValue({ id: "log-1" });
  replyToComment.mockResolvedValue({ id: "IGREPLY-1" });
  sendPrivateReply.mockResolvedValue({ messageId: "mid-1", recipientId: "IGSID-1" });
});

describe("handleComment — descartes", () => {
  it("sin conector activo no escribe nada", async () => {
    resolveByIg.mockResolvedValue(null);
    expect(await handleComment(comment())).toEqual({ status: "sin-conector" });
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("comentario de la propia cuenta se ignora (anti-loop)", async () => {
    expect(await handleComment(comment({ authorId: "17841" }))).toEqual({ status: "propio" });
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("comentario de la propia página de Facebook se ignora", async () => {
    resolveByIg.mockResolvedValue(null);
    resolveByPage.mockResolvedValue(IG_CONNECTOR);
    const out = await handleComment(
      comment({ platform: "FACEBOOK", accountId: "PAGE-1", authorId: "PAGE-1" })
    );
    expect(out).toEqual({ status: "propio" });
  });

  it("respuesta anidada se ignora (Instagram no acepta responder a una respuesta)", async () => {
    expect(await handleComment(comment({ isNested: true }))).toEqual({ status: "anidado" });
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("comentario ya registrado no se procesa dos veces", async () => {
    logFindUnique.mockResolvedValue({ id: "log-viejo" });
    expect(await handleComment(comment())).toEqual({ status: "duplicado", logId: "log-viejo" });
    expect(replyToComment).not.toHaveBeenCalled();
  });

  it("sin match no escribe log ni llama a Graph", async () => {
    expect(await handleComment(comment({ text: "qué bonito" }))).toEqual({ status: "sin-match" });
    expect(logCreate).not.toHaveBeenCalled();
    expect(replyToComment).not.toHaveBeenCalled();
  });

  it("solo consulta reglas activas del conector", async () => {
    await handleComment(comment());
    expect(ruleFindMany.mock.calls[0][0].where).toEqual({
      connectorId: "conn-ig",
      isActive: true,
      deletedAt: null,
    });
  });
});

describe("handleComment — cuota", () => {
  it("misma persona en la misma publicación queda SKIPPED sin llamar a Graph", async () => {
    logFindFirst.mockResolvedValue({ id: "log-previo" });
    const out = await handleComment(comment({ externalCommentId: "IGCOMMENT-2" }));
    expect(out.status).toBe("cuota");
    expect(replyToComment).not.toHaveBeenCalled();
    expect(sendPrivateReply).not.toHaveBeenCalled();
    expect(logCreate.mock.calls[0][0].data).toMatchObject({
      publicReplyStatus: "SKIPPED",
      dmStatus: "SKIPPED",
    });
  });

  it("la cuota se consulta por conector, publicación y autor", async () => {
    await handleComment(comment());
    expect(logFindFirst.mock.calls[0][0].where).toEqual({
      connectorId: "conn-ig",
      postId: "MEDIA-1",
      authorId: "IGSID-1",
    });
  });
});

describe("handleComment — envíos", () => {
  it("crea el log en PENDING antes de llamar a Graph", async () => {
    await handleComment(comment());
    expect(logCreate.mock.calls[0][0].data).toMatchObject({
      ruleId: "rule-1",
      connectorId: "conn-ig",
      platform: "INSTAGRAM",
      externalCommentId: "IGCOMMENT-1",
      matchedPhrase: "info",
      publicReplyStatus: "PENDING",
      dmStatus: "PENDING",
      publicText: "Te escribo al DM 📩",
      dmText: "Hola luisf, aquí va la info.",
    });
  });

  it("manda la variante pública que toca según disparos previos", async () => {
    logCount.mockResolvedValue(1);
    await handleComment(comment());
    expect(replyToComment).toHaveBeenCalledWith(
      "INSTAGRAM", "TOKEN", "IGCOMMENT-1", "Ya te mandé privado 📩"
    );
  });

  it("marca ambas acciones SENT y guarda recipient y mid del DM", async () => {
    await handleComment(comment());
    const updates = logUpdate.mock.calls.map((c) => c[0].data);
    expect(updates).toContainEqual(
      expect.objectContaining({ publicReplyStatus: "SENT", publicReplyId: "IGREPLY-1" })
    );
    expect(updates).toContainEqual(
      expect.objectContaining({
        dmStatus: "SENT",
        dmRecipientId: "IGSID-1",
        dmExternalMessageId: "mid-1",
      })
    );
  });

  it("si falla la pública, el DM sale igual y el error queda textual", async () => {
    replyToComment.mockRejectedValue(new Error("Comment reply 368: temporarily blocked"));
    const out = await handleComment(comment());
    expect(out.status).toBe("procesado");
    expect(sendPrivateReply).toHaveBeenCalled();
    expect(logUpdate.mock.calls[0][0].data).toMatchObject({
      publicReplyStatus: "FAILED",
      publicReplyError: "Comment reply 368: temporarily blocked",
    });
  });

  it("si falla el DM, la pública ya salió y el motivo se guarda", async () => {
    sendPrivateReply.mockRejectedValue(
      new Error("Private reply 10903: This comment is too old to reply privately")
    );
    const out = await handleComment(comment());
    expect(out.status).toBe("procesado");
    expect(logUpdate.mock.calls[1][0].data).toMatchObject({
      dmStatus: "FAILED",
      dmError: "Private reply 10903: This comment is too old to reply privately",
    });
  });

  it("conector sin pageAccessToken: log FAILED en ambas, sin llamar a Graph", async () => {
    getToken.mockReturnValue(null);
    const out = await handleComment(comment());
    expect(out.status).toBe("sin-token");
    expect(replyToComment).not.toHaveBeenCalled();
    expect(logCreate.mock.calls[0][0].data).toMatchObject({
      publicReplyStatus: "FAILED",
      dmStatus: "FAILED",
      dmError: "Conector sin pageAccessToken",
    });
  });

  it("intenta enganchar el opener al hilo si la persona ya es contacto", async () => {
    await handleComment(comment());
    expect(persistOpener).toHaveBeenCalledWith({
      platform: "INSTAGRAM",
      connectorId: "conn-ig",
      recipientId: "IGSID-1",
      text: "Hola luisf, aquí va la info.",
      externalMessageId: "mid-1",
    });
  });

  it("si persistOpener falla, el resultado sigue siendo procesado", async () => {
    persistOpener.mockRejectedValue(new Error("boom"));
    expect((await handleComment(comment())).status).toBe("procesado");
  });
});
