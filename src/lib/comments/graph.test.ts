import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findCommentReply, replyToComment, sendPrivateReply } from "./graph";

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
    await expect(
      replyToComment("FACEBOOK", "T", "C1", "hola", { verifyDelayMs: 0 })
    ).rejects.toThrow(/sin id/);
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

// 2026-10-10: en producción la respuesta pública a un "Info" de Instagram se
// cortó por timeout y un reintento volvió a fallar. Meta puede publicar aunque
// no conteste a tiempo, así que antes de fallar se lee el comentario.
function timeoutError() {
  return Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
}

describe("replyToComment — verificación tras timeout", () => {
  it("Instagram: si la respuesta aparece publicada, es éxito con ese id (recovered)", async () => {
    fetchMock
      .mockReturnValueOnce(timeoutError())
      .mockReturnValueOnce(
        ok({
          data: [
            { id: "OTRA", text: "gracias!" },
            { id: "IGREPLY-9", text: "te escribo al DM" },
          ],
        })
      );

    const out = await replyToComment("INSTAGRAM", "TOKEN-SECRETO", "IGCOMMENT-1", "te escribo al DM", {
      verifyDelayMs: 0,
    });

    expect(out).toEqual({ id: "IGREPLY-9", recovered: true });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://graph.facebook.com/v24.0/IGCOMMENT-1/replies?fields=id,text");
    expect(init.method).toBeUndefined(); // GET
    expect(init.headers).toEqual({ Authorization: "Bearer TOKEN-SECRETO" });
    expect(String(url)).not.toContain("TOKEN-SECRETO");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("Facebook: lee /comments con el campo message", async () => {
    fetchMock
      .mockReturnValueOnce(timeoutError())
      .mockReturnValueOnce(ok({ data: [{ id: "FBREPLY-9", message: "vamos al privado" }] }));

    const out = await replyToComment("FACEBOOK", "T", "PAGE-1_C1", "vamos al privado", {
      verifyDelayMs: 0,
    });

    expect(out).toEqual({ id: "FBREPLY-9", recovered: true });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://graph.facebook.com/v24.0/PAGE-1_C1/comments?fields=id,message"
    );
  });

  it("el texto se compara sin importar espacios o saltos de línea que Meta recorte", async () => {
    fetchMock
      .mockReturnValueOnce(timeoutError())
      .mockReturnValueOnce(ok({ data: [{ id: "IGREPLY-9", text: "Hola  @ana,\nte escribo " }] }));
    const out = await replyToComment("INSTAGRAM", "T", "C1", "Hola @ana, te escribo", {
      verifyDelayMs: 0,
    });
    expect(out.id).toBe("IGREPLY-9");
  });

  it("si no aparece publicada, falla con el error original y lo dice", async () => {
    fetchMock
      .mockReturnValueOnce(timeoutError())
      .mockReturnValueOnce(ok({ data: [{ id: "OTRA", text: "otra cosa" }] }));
    await expect(
      replyToComment("INSTAGRAM", "T", "C1", "te escribo al DM", { verifyDelayMs: 0 })
    ).rejects.toThrow(
      "The operation was aborted due to timeout — verificado en Meta: la respuesta no aparece publicada"
    );
  });

  it("si la verificación también falla, lo dice sin inventar un resultado", async () => {
    fetchMock
      .mockReturnValueOnce(timeoutError())
      .mockReturnValueOnce(fail({ error: { code: 190, message: "Invalid OAuth access token" } }));
    await expect(
      replyToComment("INSTAGRAM", "T", "C1", "hola", { verifyDelayMs: 0 })
    ).rejects.toThrow(
      "The operation was aborted due to timeout — no se pudo verificar en Meta si se publicó (Comment replies 190: Invalid OAuth access token)"
    );
  });

  it("un error de red (sin respuesta) también se verifica", async () => {
    fetchMock
      .mockReturnValueOnce(Promise.reject(new TypeError("fetch failed")))
      .mockReturnValueOnce(ok({ data: [{ id: "IGREPLY-9", text: "hola" }] }));
    const out = await replyToComment("INSTAGRAM", "T", "C1", "hola", { verifyDelayMs: 0 });
    expect(out).toEqual({ id: "IGREPLY-9", recovered: true });
  });

  it("un 200 sin id (cuerpo cortado) también se verifica antes de fallar", async () => {
    fetchMock
      .mockReturnValueOnce(ok({}))
      .mockReturnValueOnce(ok({ data: [{ id: "IGREPLY-9", text: "hola" }] }));
    const out = await replyToComment("INSTAGRAM", "T", "C1", "hola", { verifyDelayMs: 0 });
    expect(out).toEqual({ id: "IGREPLY-9", recovered: true });
  });

  it("un error de Graph con cuerpo es definitivo: no se verifica", async () => {
    fetchMock.mockReturnValue(fail({ error: { code: 368, message: "temporarily blocked" } }));
    await expect(
      replyToComment("INSTAGRAM", "T", "C1", "hola", { verifyDelayMs: 0 })
    ).rejects.toThrow("Comment reply 368: temporarily blocked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("el éxito normal no hace la lectura extra", async () => {
    fetchMock.mockReturnValue(ok({ id: "IGREPLY-1" }));
    await replyToComment("INSTAGRAM", "T", "C1", "hola");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("findCommentReply", () => {
  it("devuelve null si ninguna respuesta tiene ese texto", async () => {
    fetchMock.mockReturnValue(ok({ data: [{ id: "X", text: "otra" }] }));
    expect(await findCommentReply("INSTAGRAM", "T", "C1", "hola")).toBeNull();
  });

  it("devuelve null si el comentario no tiene respuestas", async () => {
    fetchMock.mockReturnValue(ok({ data: [] }));
    expect(await findCommentReply("FACEBOOK", "T", "C1", "hola")).toBeNull();
  });

  it("lanza con el mensaje textual de Meta si Graph falla", async () => {
    fetchMock.mockReturnValue(fail({ error: { code: 100, message: "Unsupported get request" } }));
    await expect(findCommentReply("INSTAGRAM", "T", "C1", "hola")).rejects.toThrow(
      "Comment replies 100: Unsupported get request"
    );
  });

  it("el token va en la cabecera Authorization, nunca en la URL", async () => {
    fetchMock.mockReturnValue(ok({ data: [] }));
    await findCommentReply("INSTAGRAM", "TOKEN-SECRETO", "C1", "hola");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("TOKEN-SECRETO");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer TOKEN-SECRETO" });
  });
});
