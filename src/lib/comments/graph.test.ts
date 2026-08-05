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

describe("postJson — robustez (code review)", () => {
  it("res.ok=true con error en el body (Graph miente con 200): debe lanzar, no resolver", async () => {
    fetchMock.mockReturnValue(
      ok({ error: { code: 200, message: "algo salió mal aunque status sea 200" } })
    );
    await expect(replyToComment("INSTAGRAM", "T", "C1", "hola")).rejects.toThrow(
      "Comment reply 200: algo salió mal aunque status sea 200"
    );
  });

  it("error como string: se conserva el mensaje textual de Meta", async () => {
    fetchMock.mockReturnValue(fail({ error: "algo salió mal" }, 400));
    await expect(replyToComment("INSTAGRAM", "T", "C1", "hola")).rejects.toThrow(
      "Comment reply 400: algo salió mal"
    );
  });

  it("respuesta que no es JSON con ok=false: lanza usando el status, sin reventar por el JSON", async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("Unexpected end of JSON input")),
      })
    );
    await expect(replyToComment("INSTAGRAM", "T", "C1", "hola")).rejects.toThrow(
      "Comment reply 503"
    );
  });

  it("Fix 1 (regresión): __ok:true en el body con res.ok=false no disfraza un fallo como éxito", async () => {
    fetchMock.mockReturnValue(fail({ __ok: true, id: "FAKE-SUCCESS-ID" }, 400));
    await expect(replyToComment("INSTAGRAM", "T", "C1", "hola")).rejects.toThrow();
  });

  it("fallo de red: el error se propaga y su mensaje no contiene el token", async () => {
    fetchMock.mockReturnValue(Promise.reject(new Error("network error")));
    let caught: unknown;
    try {
      await replyToComment("INSTAGRAM", "TOKEN-SECRETO", "C1", "hola");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String((caught as Error).message)).not.toContain("TOKEN-SECRETO");
  });

  it("el fetch recibe un signal (AbortSignal) para que nadie borre el timeout en silencio", async () => {
    fetchMock.mockReturnValue(ok({ id: "x" }));
    await replyToComment("INSTAGRAM", "T", "C1", "hola");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
