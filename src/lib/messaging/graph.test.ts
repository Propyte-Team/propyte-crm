import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendGraphMessage, sendGraphAttachment, GraphSendError } from "./graph";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function reply(ok: boolean, status: number, body: unknown) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

// 2026-10-10: el rechazo de la Send API trae code y subcode sueltos para poder
// explicar en el Inbox por qué el bot no contestó (lib/messaging/send-failure.ts).
describe("sendGraphMessage — rechazo de Meta", () => {
  it("lanza GraphSendError con code, subcode y el mensaje de siempre", async () => {
    fetchMock.mockReturnValue(
      reply(false, 400, { error: { code: 10, error_subcode: 2534022, message: "(#10) outside of allowed window" } })
    );
    const err = await sendGraphMessage("TOKEN", "IGSID-1", "hola").catch((e) => e);
    expect(err).toBeInstanceOf(GraphSendError);
    expect(err.message).toBe("Graph send 10: (#10) outside of allowed window");
    expect(err).toMatchObject({ status: 400, code: 10, subcode: 2534022, graphMessage: "(#10) outside of allowed window" });
  });

  it("sin cuerpo de error usa el status, como antes", async () => {
    fetchMock.mockReturnValue(reply(false, 503, {}));
    const err = await sendGraphMessage("TOKEN", "IGSID-1", "hola").catch((e) => e);
    expect(err.message).toBe("Graph send 503: error");
    expect(err).toMatchObject({ code: null, subcode: null, graphMessage: null });
  });

  it("el éxito no cambia", async () => {
    fetchMock.mockReturnValue(reply(true, 200, { message_id: "mid-1" }));
    expect(await sendGraphMessage("TOKEN", "IGSID-1", "hola")).toEqual({ externalMessageId: "mid-1", status: "SENT" });
  });

  it("el adjunto también lanza GraphSendError", async () => {
    fetchMock.mockReturnValue(reply(false, 400, { error: { code: 100, message: "bad url" } }));
    const err = await sendGraphAttachment("TOKEN", "IGSID-1", { url: "https://x/a.jpg", type: "image" }).catch((e) => e);
    expect(err).toBeInstanceOf(GraphSendError);
    expect(err.message).toBe("Graph attachment 100: bad url");
  });
});
