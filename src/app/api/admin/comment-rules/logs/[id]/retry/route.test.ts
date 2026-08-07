import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const logFindUnique = vi.fn();
const logUpdateMany = vi.fn();
const logUpdate = vi.fn();
const connectorFindFirst = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    commentRuleLog: {
      findUnique: (...a: unknown[]) => logFindUnique(...a),
      updateMany: (...a: unknown[]) => logUpdateMany(...a),
      update: (...a: unknown[]) => logUpdate(...a),
    },
    leadConnector: { findFirst: (...a: unknown[]) => connectorFindFirst(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

const getToken = vi.fn();
vi.mock("@/lib/messaging/social-accounts", () => ({
  getSocialPageToken: (...a: unknown[]) => getToken(...a),
}));

const replyToComment = vi.fn();
const sendPrivateReply = vi.fn();
vi.mock("@/lib/comments/graph", () => ({
  replyToComment: (...a: unknown[]) => replyToComment(...a),
  sendPrivateReply: (...a: unknown[]) => sendPrivateReply(...a),
}));

const persistOpener = vi.fn();
vi.mock("@/lib/comments/link-comment-origin", () => ({
  persistOpenerCreatingContact: (...a: unknown[]) => persistOpener(...a),
}));

import { POST } from "./route";

function req() {
  return new Request("http://t/api", { method: "POST" }) as never;
}

function ctx(id = "log-1") {
  return { params: { id } };
}

const CONNECTOR = { id: "conn-1", status: "ACTIVE", deletedAt: null, credentials: "cipher" };

const LOG_BOTH_FAILED = {
  id: "log-1",
  connectorId: "conn-1",
  platform: "INSTAGRAM",
  externalCommentId: "IGCOMMENT-1",
  postId: "MEDIA-1",
  authorHandle: "luisf",
  matchedPhrase: "info",
  publicReplyStatus: "FAILED",
  publicText: "Texto público exacto",
  dmStatus: "FAILED",
  dmText: "Texto DM exacto",
};

/** Simula el candado: cuenta 1 salvo que el `where` pida un estado incluido en `losers`. */
function mockClaims(losers: Array<"publicReplyStatus" | "dmStatus"> = []) {
  logUpdateMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    const field = "publicReplyStatus" in args.where ? "publicReplyStatus" : "dmStatus";
    return { count: losers.includes(field) ? 0 : 1 };
  });
}

beforeEach(() => {
  for (const m of [
    logFindUnique, logUpdateMany, logUpdate, connectorFindFirst, auditCreate,
    getToken, replyToComment, sendPrivateReply, persistOpener,
  ]) m.mockReset();

  session.user.role = "ADMIN";
  logFindUnique.mockResolvedValue(LOG_BOTH_FAILED);
  connectorFindFirst.mockResolvedValue(CONNECTOR);
  getToken.mockReturnValue("TOKEN");
  mockClaims();
  logUpdate.mockImplementation(async (args: { data: unknown }) => ({ id: "log-1", ...(args.data as object) }));
  auditCreate.mockResolvedValue({});
  replyToComment.mockResolvedValue({ id: "IGREPLY-1" });
  sendPrivateReply.mockResolvedValue({ messageId: "mid-1", recipientId: "PSID-1" });
  // La ruta encadena .catch() sobre el resultado: el mock tiene que devolver
  // una promesa o el TypeError caería dentro del try del DM y lo marcaría FAILED.
  persistOpener.mockResolvedValue({ contactId: "c-1", isNewContact: true, conversationId: "conv-1" });
});

describe("POST /api/admin/comment-rules/logs/[id]/retry", () => {
  it("dmStatus FAILED pero publicReplyStatus SENT: no llama replyToComment, sí sendPrivateReply con el texto exacto", async () => {
    logFindUnique.mockResolvedValue({
      ...LOG_BOTH_FAILED,
      publicReplyStatus: "SENT",
      publicReplyId: "IGREPLY-OLD",
    });

    const res = await POST(req(), ctx());

    expect(res.status).toBe(200);
    expect(replyToComment).not.toHaveBeenCalled();
    expect(sendPrivateReply).toHaveBeenCalledWith("TOKEN", "IGCOMMENT-1", "Texto DM exacto");
  });

  it("manda el texto EXACTO guardado en el log (publicText y dmText), sin reconstruirlo", async () => {
    await POST(req(), ctx());

    expect(replyToComment).toHaveBeenCalledWith(
      "INSTAGRAM",
      "TOKEN",
      "IGCOMMENT-1",
      "Texto público exacto"
    );
    expect(sendPrivateReply).toHaveBeenCalledWith("TOKEN", "IGCOMMENT-1", "Texto DM exacto");
  });

  // Cambio de producto 2026-08-06: el reintento también materializa el hilo —
  // crea el contacto si no existe y le engancha el opener, igual que el envío
  // original. Necesita el logId y los campos del log para la nota de origen.
  it("el DM reintentado también crea contacto e hilo, con el logId y los datos del comentario", async () => {
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(persistOpener).toHaveBeenCalledWith({
      logId: "log-1",
      platform: "INSTAGRAM",
      connectorId: "conn-1",
      recipientId: "PSID-1",
      authorHandle: "luisf",
      postId: "MEDIA-1",
      matchedPhrase: "info",
      text: "Texto DM exacto",
      externalMessageId: "mid-1",
    });
    expect(logUpdate.mock.calls[0][0].data).toMatchObject({ dmStatus: "SENT" });
  });

  // El mid tiene que estar EN LA BASE antes de que el opener empiece: si no,
  // el eco de Meta que llegue mientras persistOpenerCreatingContact crea el
  // contacto (cientos de ms) no encuentra ni el opener ni el log, entra como
  // ADVISOR y aplica el takeover — el bot se calla. Ver el comentario largo en
  // la ruta.
  it("persiste dmExternalMessageId en el log ANTES de llamar al opener (si no, el eco enmudece al bot)", async () => {
    await POST(req(), ctx());

    expect(logUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: "log-1" },
      data: { dmStatus: "SENT", dmRecipientId: "PSID-1", dmExternalMessageId: "mid-1" },
    });
    expect(logUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      persistOpener.mock.invocationCallOrder[0]
    );
  });

  it("si el opener falla, el DM NO se marca FAILED (ya está en el chat del cliente)", async () => {
    persistOpener.mockRejectedValue(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(req(), ctx());

    expect(res.status).toBe(200);
    const updates = logUpdate.mock.calls.map((c) => c[0].data);
    expect(updates).not.toContainEqual(expect.objectContaining({ dmStatus: "FAILED" }));
    expect(updates).toContainEqual(expect.objectContaining({ dmStatus: "SENT" }));
    errSpy.mockRestore();
  });

  it("404 si el registro no existe", async () => {
    logFindUnique.mockResolvedValue(null);
    expect((await POST(req(), ctx())).status).toBe(404);
  });

  it("400 si nada está FAILED ni PENDING", async () => {
    logFindUnique.mockResolvedValue({
      ...LOG_BOTH_FAILED,
      publicReplyStatus: "SENT",
      dmStatus: "SKIPPED",
    });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(400);
    expect(replyToComment).not.toHaveBeenCalled();
    expect(sendPrivateReply).not.toHaveBeenCalled();
  });

  it("acepta también PENDING (Fix 3: worker muerto a mitad de la llamada a Graph)", async () => {
    logFindUnique.mockResolvedValue({
      ...LOG_BOTH_FAILED,
      publicReplyStatus: "PENDING",
      dmStatus: "SENT",
    });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(replyToComment).toHaveBeenCalled();
  });

  it("400 si el conector está pausado (Fix 1)", async () => {
    connectorFindFirst.mockResolvedValue(null); // el where con status:"ACTIVE" no lo encuentra
    const res = await POST(req(), ctx());
    expect(res.status).toBe(400);
    expect(connectorFindFirst.mock.calls[0][0].where).toMatchObject({ status: "ACTIVE" });
    expect(replyToComment).not.toHaveBeenCalled();
    expect(sendPrivateReply).not.toHaveBeenCalled();
  });

  it("409 si el candado no reclama nada — otro reintento ya lo tomó (Fix 2)", async () => {
    logFindUnique.mockResolvedValue({
      ...LOG_BOTH_FAILED,
      publicReplyStatus: "FAILED",
      dmStatus: "SENT", // solo la pública es elegible
    });
    mockClaims(["publicReplyStatus"]); // el único candado elegible se pierde
    const res = await POST(req(), ctx());
    expect(res.status).toBe(409);
    expect(replyToComment).not.toHaveBeenCalled();
    expect(logUpdate).not.toHaveBeenCalled();
  });

  it("candados independientes: reclama la pública aunque el DM ya esté ganado por otro reintento", async () => {
    mockClaims(["dmStatus"]);
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(replyToComment).toHaveBeenCalled();
    expect(sendPrivateReply).not.toHaveBeenCalled();
  });

  it("403 para rol no permitido", async () => {
    session.user.role = "ASESOR";
    expect((await POST(req(), ctx())).status).toBe(403);
    expect(logFindUnique).not.toHaveBeenCalled();
  });

  it("audita el reintento con qué acción se reintentó y con qué resultado (Fix 4)", async () => {
    await POST(req(), ctx());
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const data = auditCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: "u1",
      action: "UPDATE",
      entity: "CommentRuleLog",
      entityId: "log-1",
    });
    expect(data.changes).toBeTruthy();
  });

  it("si falla la llamada a Graph tras reclamar el candado, el estado vuelve a FAILED (no queda PENDING colgado)", async () => {
    replyToComment.mockRejectedValue(new Error("Invalid OAuth access token"));
    await POST(req(), ctx());
    // El último update es el consolidado del final: el primero ya no lo es
    // desde que el mid del DM se persiste por adelantado (ver test del orden).
    expect(logUpdate.mock.calls.at(-1)?.[0].data).toMatchObject({
      publicReplyStatus: "FAILED",
      publicReplyError: "Invalid OAuth access token",
    });
  });
});
