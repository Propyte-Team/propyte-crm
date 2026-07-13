import { describe, it, expect, vi, beforeEach } from "vitest";

const handleInboundMessage = vi.fn();
const resolveByIg = vi.fn();
const resolveByPage = vi.fn();
vi.mock("@/lib/messaging/core", () => ({ handleInboundMessage: (...a: unknown[]) => handleInboundMessage(...a) }));
vi.mock("@/lib/messaging/social-accounts", () => ({
  resolveConnectorByIgBusinessId: (...a: unknown[]) => resolveByIg(...a),
  resolveConnectorByPageId: (...a: unknown[]) => resolveByPage(...a),
}));

import { GET, POST } from "./route";

beforeEach(() => {
  handleInboundMessage.mockReset();
  resolveByIg.mockReset();
  resolveByPage.mockReset();
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
      expect.objectContaining({ channel: "INSTAGRAM", senderId: "IGSID-1", externalMessageId: "mid-1" })
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
      })
    );
  });
});
