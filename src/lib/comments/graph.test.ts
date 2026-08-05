import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { replyToComment, sendPrivateReply } from "./graph";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}
function fail(body: unknown, status = 400) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) });
}

describe("replyToComment", () => {
  it("Instagram usa la arista /replies", async () => {
    fetchMock.mockReturnValue(ok({ id: "IGREPLY-1" }));
    const out = await replyToComment("INSTAGRAM", "TOKEN", "IGCOMMENT-1", "te escribo al DM");
    expect(out).toEqual({ id: "IGREPLY-1" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v24.0/IGCOMMENT-1/replies");
  });

  it("Facebook usa la arista /comments", async () => {
    fetchMock.mockReturnValue(ok({ id: "FBREPLY-1" }));
    await replyToComment("FACEBOOK", "TOKEN", "PAGE-1_COMMENT-1", "vamos al privado");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://graph.facebook.com/v24.0/PAGE-1_COMMENT-1/comments"
    );
  });

  it("manda el token en el body, nunca en la URL", async () => {
    fetchMock.mockReturnValue(ok({ id: "x" }));
    await replyToComment("INSTAGRAM", "TOKEN-SECRETO", "C1", "hola");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("TOKEN-SECRETO");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      message: "hola",
      access_token: "TOKEN-SECRETO",
    });
  });

  it("propaga el mensaje textual de Meta, no un genérico", async () => {
    fetchMock.mockReturnValue(fail({ error: { code: 190, message: "Invalid OAuth access token" } }));
    await expect(replyToComment("INSTAGRAM", "T", "C1", "hola")).rejects.toThrow(
      "Comment reply 190: Invalid OAuth access token"
    );
  });

  it("respuesta sin id se considera error", async () => {
    fetchMock.mockReturnValue(ok({}));
    await expect(replyToComment("FACEBOOK", "T", "C1", "hola")).rejects.toThrow(/sin id/);
  });
});

describe("sendPrivateReply", () => {
  it("manda recipient.comment_id y devuelve message_id y recipient_id", async () => {
    fetchMock.mockReturnValue(ok({ message_id: "mid-1", recipient_id: "PSID-1" }));
    const out = await sendPrivateReply("TOKEN", "PAGE-1_COMMENT-1", "Hola, te paso info");
    expect(out).toEqual({ messageId: "mid-1", recipientId: "PSID-1" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v24.0/me/messages");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      recipient: { comment_id: "PAGE-1_COMMENT-1" },
      message: { text: "Hola, te paso info" },
      access_token: "TOKEN",
    });
  });

  it("recipient_id ausente no rompe (queda null)", async () => {
    fetchMock.mockReturnValue(ok({ message_id: "mid-2" }));
    expect(await sendPrivateReply("T", "C1", "hola")).toEqual({
      messageId: "mid-2",
      recipientId: null,
    });
  });

  it("ventana vencida: propaga el error de Meta tal cual", async () => {
    fetchMock.mockReturnValue(
      fail({ error: { code: 10903, message: "This comment is too old to reply privately" } })
    );
    await expect(sendPrivateReply("T", "C1", "hola")).rejects.toThrow(
      "Private reply 10903: This comment is too old to reply privately"
    );
  });
});
