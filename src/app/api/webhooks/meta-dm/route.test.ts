import { describe, it, expect, vi, beforeEach } from "vitest";

const handleInboundMessage = vi.fn();
const resolveByIg = vi.fn();
const resolveByPage = vi.fn();
const botRespond = vi.fn();
const handleComment = vi.fn();
vi.mock("@/lib/messaging/core", () => ({ handleInboundMessage: (...a: unknown[]) => handleInboundMessage(...a) }));
vi.mock("@/lib/messaging/social-accounts", () => ({
  resolveConnectorByIgBusinessId: (...a: unknown[]) => resolveByIg(...a),
  resolveConnectorByPageId: (...a: unknown[]) => resolveByPage(...a),
}));
vi.mock("@/lib/bot/bot-respond", () => ({ botRespond: (...a: unknown[]) => botRespond(...a) }));
vi.mock("@/lib/comments/handle-comment", () => ({
  handleComment: (...a: unknown[]) => handleComment(...a),
}));

import { GET, POST } from "./route";

beforeEach(() => {
  handleInboundMessage.mockReset();
  resolveByIg.mockReset();
  resolveByPage.mockReset();
  botRespond.mockReset();
  handleComment.mockReset();
  handleComment.mockResolvedValue({ status: "procesado", logId: "log-1" });
  process.env.META_DM_VERIFY_TOKEN = "verifyme";
  delete process.env.META_DM_APP_SECRET;
});

function req(url: string, init?: RequestInit) { return new Request(url, init) as unknown as import("next/server").NextRequest; }

describe("meta-dm webhook", () => {
  it("GET responde el challenge con verify token correcto", async () => {
    const res = await GET(req("https://x/api/webhooks/meta-dm?hub.mode=subscribe&hub.verify_token=verifyme&hub.challenge=42"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("42");
  });

  it("GET rechaza verify token incorrecto", async () => {
    const res = await GET(req("https://x/api/webhooks/meta-dm?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=42"));
    expect(res.status).toBe(403);
  });

  it("POST de IG enruta cada mensaje al core", async () => {
    handleInboundMessage.mockResolvedValue({ id: "m1" });
    const body = JSON.stringify({ object: "instagram", entry: [{ messaging: [{ sender: { id: "IGSID-1" }, message: { mid: "mid-1", text: "hola" } }] }] });
    const res = await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(handleInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "INSTAGRAM", senderId: "IGSID-1", externalMessageId: "mid-1" }),
      { triggerBot: false }
    );
  });

  it("resuelve el conector IG por igBusinessId y setea connectorId en el mensaje", async () => {
    resolveByIg.mockResolvedValue({ id: "conn_ig" });
    const body = JSON.stringify({ object: "instagram", entry: [{ id: "17841", messaging: [
      { sender: { id: "IGSID" }, message: { mid: "m1", text: "hi" } },
    ] }] });
    await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(resolveByIg).toHaveBeenCalledWith("17841");
    expect(handleInboundMessage.mock.calls[0][0].connectorId).toBe("conn_ig");
  });

  it("procesa igual (connectorId null) si no hay conector para la cuenta", async () => {
    resolveByIg.mockResolvedValue(null);
    const body = JSON.stringify({ object: "instagram", entry: [{ id: "999", messaging: [
      { sender: { id: "IGSID" }, message: { mid: "m2", text: "hi" } },
    ] }] });
    await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(handleInboundMessage).toHaveBeenCalledTimes(1);
    expect(handleInboundMessage.mock.calls[0][0].connectorId ?? null).toBeNull();
  });

  it("echo de page (message_echoes) fluye al core con isEcho, echoAppId y connectorId", async () => {
    resolveByPage.mockResolvedValue({ id: "conn_ms" });
    const body = JSON.stringify({ object: "page", entry: [{ id: "103981", messaging: [{
      sender: { id: "103981" },
      recipient: { id: "PSID-user" },
      message: { mid: "mid-echo-r1", text: "respuesta desde Business Suite", is_echo: true, app_id: 263902037430900 },
    }] }] });
    const res = await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(handleInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "MESSENGER",
        senderId: "PSID-user",
        isEcho: true,
        echoAppId: "263902037430900",
        connectorId: "conn_ms",
      }),
      { triggerBot: false }
    );
  });

  // BUG 2026-07-24: cada mensaje del batch disparaba una respuesta completa del bot.
  it("batch de 2 mensajes del mismo usuario → bot UNA sola vez con canal y conector", async () => {
    resolveByPage.mockResolvedValue({ id: "conn_ms" });
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c9" });
    const body = JSON.stringify({ object: "page", entry: [{ id: "103981", messaging: [
      { sender: { id: "PSID-1" }, message: { mid: "mm1", text: "hola" } },
      { sender: { id: "PSID-1" }, message: { mid: "mm2", attachments: [{ type: "file", payload: { url: "https://f/x.pdf" } }] } },
    ] }] });
    const res = await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(handleInboundMessage).toHaveBeenCalledTimes(2);
    expect(botRespond).toHaveBeenCalledTimes(1);
    expect(botRespond).toHaveBeenCalledWith("c9", { channel: "MESSENGER", connectorId: "conn_ms" });
  });

  it("echo NO dispara al bot", async () => {
    resolveByPage.mockResolvedValue({ id: "conn_ms" });
    handleInboundMessage.mockResolvedValue({ id: "m-echo", contactId: "c9" });
    const body = JSON.stringify({ object: "page", entry: [{ id: "103981", messaging: [{
      sender: { id: "103981" },
      recipient: { id: "PSID-user" },
      message: { mid: "mid-echo-2", text: "respuesta externa", is_echo: true },
    }] }] });
    await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(botRespond).not.toHaveBeenCalled();
  });
});

describe("meta-dm webhook — comentarios", () => {
  it("payload de comentarios de IG llega al motor de comentarios", async () => {
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ id: "17841", changes: [{ field: "comments", value: {
        id: "IGCOMMENT-1", text: "info", from: { id: "IGSID-1", username: "luisf" },
        media: { id: "MEDIA-1" },
      } }] }],
    });
    const res = await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(handleComment).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "INSTAGRAM", externalCommentId: "IGCOMMENT-1", accountId: "17841",
      })
    );
    expect(handleInboundMessage).not.toHaveBeenCalled();
  });

  it("payload de comentarios de Facebook llega al motor", async () => {
    const body = JSON.stringify({
      object: "page",
      entry: [{ id: "PAGE-1", changes: [{ field: "feed", value: {
        item: "comment", verb: "add", comment_id: "C-1", post_id: "P-1", parent_id: "P-1",
        from: { id: "ASID-1", name: "Luis" }, message: "info",
      } }] }],
    });
    await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(handleComment).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "FACEBOOK", externalCommentId: "C-1" })
    );
  });

  it("REGRESIÓN: un DM sigue yendo al intake y NO al motor de comentarios", async () => {
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c1" });
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ messaging: [{ sender: { id: "IGSID-1" }, message: { mid: "mid-1", text: "hola" } }] }],
    });
    await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(handleInboundMessage).toHaveBeenCalled();
    expect(handleComment).not.toHaveBeenCalled();
  });

  it("un comentario que revienta no tumba el resto del batch", async () => {
    handleComment.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ status: "procesado" });
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ id: "17841", changes: [
        { field: "comments", value: { id: "C-1", text: "info", from: { id: "A" }, media: { id: "M" } } },
        { field: "comments", value: { id: "C-2", text: "info", from: { id: "B" }, media: { id: "M" } } },
      ] }],
    });
    const res = await POST(req("https://x/api/webhooks/meta-dm", { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(handleComment).toHaveBeenCalledTimes(2);
  });
});
