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
  persistOpenerCreatingContact: (...a: unknown[]) => persistOpener(...a),
}));

const isSenderBlocked = vi.fn();
vi.mock("@/lib/moderation/is-blocked", () => ({
  isSenderBlocked: (...a: unknown[]) => isSenderBlocked(...a),
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

  isSenderBlocked.mockReset();
  isSenderBlocked.mockResolvedValue(false);

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

  // Cambio de producto 2026-08-06: el hilo se materializa con el envío, así que
  // se le pasa todo lo que hace falta para dar de alta al contacto (handle) y
  // para estampar el log + la nota de origen (logId, postId, matchedPhrase).
  it("engancha el opener al hilo pasando el log y el handle para poder crear el contacto", async () => {
    await handleComment(comment());
    expect(persistOpener).toHaveBeenCalledWith({
      logId: "log-1",
      platform: "INSTAGRAM",
      connectorId: "conn-ig",
      recipientId: "IGSID-1",
      authorHandle: "luisf",
      postId: "MEDIA-1",
      matchedPhrase: "info",
      text: "Hola luisf, aquí va la info.",
      externalMessageId: "mid-1",
    });
  });

  // El try/catch que envuelve la llamada al opener es lo único que impide que
  // el error caiga al catch exterior y marque dmStatus FAILED un DM que YA está
  // en el chat del cliente. Sin la segunda aserción, quitar ese try/catch dejaba
  // los 25 tests en verde: `procesado` se devuelve igual por las dos ramas.
  // Gemelo del test de la ruta de reintento, pero para el camino que corre en
  // CADA comentario. El mid tiene que estar EN LA BASE antes de que empiece el
  // opener: persistOpenerCreatingContact tarda cientos de ms creando el
  // contacto (alta + eventos + ruteo + SLA), y un eco de Meta que llegue en esa
  // ventana no encontraría ni el opener ni el log por dmExternalMessageId, pero
  // sí el contacto → entraría como ADVISOR y aplicaría el takeover: bot mudo.
  it("persiste dmExternalMessageId en el log ANTES de llamar al opener (si no, el eco enmudece al bot)", async () => {
    await handleComment(comment());

    const dmUpdateIdx = logUpdate.mock.calls.findIndex((c) => c[0].data.dmStatus === "SENT");
    expect(dmUpdateIdx).toBeGreaterThanOrEqual(0);
    expect(logUpdate.mock.calls[dmUpdateIdx][0].data).toMatchObject({
      dmStatus: "SENT",
      dmRecipientId: "IGSID-1",
      dmExternalMessageId: "mid-1",
    });
    expect(logUpdate.mock.invocationCallOrder[dmUpdateIdx]).toBeLessThan(
      persistOpener.mock.invocationCallOrder[0]
    );
  });

  it("si persistOpener falla (contacto u opener), sigue procesado y el DM NO se marca FAILED", async () => {
    persistOpener.mockRejectedValue(new Error("boom"));
    expect((await handleComment(comment())).status).toBe("procesado");
    const updates = logUpdate.mock.calls.map((c) => c[0].data);
    expect(updates).not.toContainEqual(expect.objectContaining({ dmStatus: "FAILED" }));
    expect(updates).toContainEqual(expect.objectContaining({ dmStatus: "SENT" }));
  });

  it("el DM sigue contando como enviado aunque el contacto no sea capturable (opener devuelve null)", async () => {
    persistOpener.mockResolvedValue(null);
    const out = await handleComment(comment());
    expect(out.status).toBe("procesado");
    const updates = logUpdate.mock.calls.map((c) => c[0].data);
    expect(updates).toContainEqual(expect.objectContaining({ dmStatus: "SENT" }));
    expect(updates).not.toContainEqual(expect.objectContaining({ dmStatus: "FAILED" }));
  });

  // Fix 5 (code review, detectado por el implementer de la Task 6): si
  // publicReplies estuviera vacío, pickVariant devuelve null, publicText queda
  // "" y el `if (publicText)` salta la respuesta pública — pero el log se
  // quedaba con publicReplyStatus: "PENDING" SIN ninguna ruta que lo
  // actualizara: invisible en la UI, ni enviado ni fallido. La validación de
  // reglas exige al menos una variante, así que no debería pasar, pero un
  // estado terminal imposible de alcanzar es una trampa.
  it("Fix 5: publicReplies vacío deja el log en SKIPPED (no PENDING eterno), sin llamar a replyToComment", async () => {
    ruleFindMany.mockResolvedValue([{ ...RULE, publicReplies: [] }]);
    const out = await handleComment(comment());
    expect(out.status).toBe("procesado");
    expect(replyToComment).not.toHaveBeenCalled();
    const updates = logUpdate.mock.calls.map((c) => c[0].data);
    expect(updates).toContainEqual(
      expect.objectContaining({
        publicReplyStatus: "SKIPPED",
        publicReplyError: expect.stringContaining("respuesta pública"),
      })
    );
  });

  // Fix 1 (code review, Task 6): la llamada a Graph y el update de Prisma que
  // la registra vivían en el mismo try. Si Graph tiene éxito pero el update
  // inmediatamente posterior revienta (blip de la base), el catch escribía
  // FAILED con el mensaje de Prisma — mintiendo: el comentario ya salió en
  // público, o el DM ya está en el chat del cliente. Para el DM es peor: sin
  // dmExternalMessageId persistido, el guard de handleEchoMessage
  // (lib/messaging/core.ts) no encuentra el log, cae al camino viejo, registra
  // el eco como ADVISOR y dispara el takeover que enmudece al bot.
  it("Fix 1: replyToComment tiene éxito pero el update posterior falla — no marca FAILED, avisa por consola, sigue procesado", async () => {
    const writeErr = new Error("Prisma blip");
    logUpdate.mockRejectedValueOnce(writeErr);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await handleComment(comment());

    expect(out.status).toBe("procesado");
    const updates = logUpdate.mock.calls.map((c) => c[0].data);
    expect(updates).not.toContainEqual(expect.objectContaining({ publicReplyStatus: "FAILED" }));

    const alert = errSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("ALERTA reconciliación manual")
    );
    expect(alert).toBeDefined();
    expect(alert?.[0]).toContain("log-1");
    expect(alert?.[0]).toContain("IGREPLY-1");
    expect(alert?.[1]).toBe(writeErr);

    errSpy.mockRestore();
  });

  it("Fix 1: sendPrivateReply tiene éxito pero el update posterior falla — no marca dmStatus FAILED, intenta persistOpener igual, sigue procesado", async () => {
    const writeErr = new Error("Prisma blip DM");
    logUpdate.mockResolvedValueOnce({ id: "log-1" }); // update SENT de la pública: ok
    logUpdate.mockRejectedValueOnce(writeErr); // update SENT del DM: falla
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await handleComment(comment());

    expect(out.status).toBe("procesado");
    const updates = logUpdate.mock.calls.map((c) => c[0].data);
    expect(updates).not.toContainEqual(expect.objectContaining({ dmStatus: "FAILED" }));
    expect(persistOpener).toHaveBeenCalledWith({
      logId: "log-1",
      platform: "INSTAGRAM",
      connectorId: "conn-ig",
      recipientId: "IGSID-1",
      authorHandle: "luisf",
      postId: "MEDIA-1",
      matchedPhrase: "info",
      text: "Hola luisf, aquí va la info.",
      externalMessageId: "mid-1",
    });

    const alert = errSpy.mock.calls.find(
      ([msg]) => typeof msg === "string" && msg.includes("ALERTA reconciliación manual")
    );
    expect(alert).toBeDefined();
    expect(alert?.[0]).toContain("log-1");
    expect(alert?.[0]).toContain("mid-1");
    expect(alert?.[1]).toBe(writeErr);

    errSpy.mockRestore();
  });

  // Regresión: si Graph falla de verdad (no el update), el log sí debe seguir
  // terminando en FAILED con el mensaje textual de Meta. Cubierto arriba por
  // "si falla la pública..." y "si falla el DM..." — se dejan intactos.
});

describe("handleComment — Facebook camino feliz", () => {
  it("Facebook: resuelto por resolveConnectorByPageId, match → cuota → log → replyToComment('FACEBOOK', ...) → sendPrivateReply → procesado", async () => {
    resolveByIg.mockResolvedValue(null);
    resolveByPage.mockResolvedValue({
      id: "conn-fb",
      provider: "FACEBOOK",
      config: { pageId: "PAGE-1" },
    });
    replyToComment.mockResolvedValue({ id: "FBREPLY-1" });
    sendPrivateReply.mockResolvedValue({ messageId: "fb-mid-1", recipientId: "PSID-1" });

    const out = await handleComment(
      comment({
        platform: "FACEBOOK",
        accountId: "PAGE-1",
        authorId: "PSID-1",
        externalCommentId: "FBCOMMENT-1",
      })
    );

    expect(resolveByPage).toHaveBeenCalledWith("PAGE-1");
    expect(out.status).toBe("procesado");
    expect(replyToComment).toHaveBeenCalledWith(
      "FACEBOOK",
      "TOKEN",
      "FBCOMMENT-1",
      expect.any(String)
    );
    expect(sendPrivateReply).toHaveBeenCalledWith("TOKEN", "FBCOMMENT-1", expect.any(String));
  });
});

describe("handleComment — autor bloqueado", () => {
  it("no responde en público ni manda DM", async () => {
    resolveByIg.mockResolvedValue(IG_CONNECTOR);
    isSenderBlocked.mockResolvedValue(true);

    const res = await handleComment(comment());

    expect(res.status).toBe("bloqueado");
    expect(replyToComment).not.toHaveBeenCalled();
    expect(sendPrivateReply).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("consulta la lista con el canal INSTAGRAM y el authorId", async () => {
    resolveByIg.mockResolvedValue(IG_CONNECTOR);
    isSenderBlocked.mockResolvedValue(true);

    await handleComment(comment({ authorId: "IGSID-42" }));

    expect(isSenderBlocked).toHaveBeenCalledWith("INSTAGRAM", "IGSID-42");
  });

  it("un comentario de Facebook consulta el canal MESSENGER", async () => {
    resolveByPage.mockResolvedValue({ id: "conn-fb", provider: "MESSENGER", config: { pageId: "PAGE-1" } });
    isSenderBlocked.mockResolvedValue(true);

    await handleComment(comment({ platform: "FACEBOOK", accountId: "PAGE-1", authorId: "PSID-7" }));

    expect(isSenderBlocked).toHaveBeenCalledWith("MESSENGER", "PSID-7");
  });
});
