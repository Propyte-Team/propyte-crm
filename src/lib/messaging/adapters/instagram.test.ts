import { describe, it, expect } from "vitest";
import { parseInstagramWebhook } from "./instagram";
import { parseMessengerWebhook } from "./messenger";

describe("parseInstagramWebhook", () => {
  it("extrae IncomingMessage de un evento messaging de IG", () => {
    const payload = {
      object: "instagram",
      entry: [{ messaging: [{ sender: { id: "IGSID-1" }, message: { mid: "mid-1", text: "hola" } }] }],
    };
    const out = parseInstagramWebhook(payload);
    expect(out).toEqual([
      { channel: "INSTAGRAM", senderId: "IGSID-1", externalMessageId: "mid-1", text: "hola", mediaUrl: null, accountId: null },
    ]);
  });
  it("ignora echoes (mensajes salientes propios) y eventos sin message", () => {
    const payload = {
      object: "instagram",
      entry: [{ messaging: [{ sender: { id: "X" }, message: { mid: "m", text: "x", is_echo: true } }, { sender: { id: "Y" }, read: {} }] }],
    };
    expect(parseInstagramWebhook(payload)).toEqual([]);
  });
  it("captura accountId desde entry.id (cuenta IG receptora)", () => {
    const out = parseInstagramWebhook({
      object: "instagram",
      entry: [{ id: "17841453458089530", messaging: [
        { sender: { id: "IGSID_123" }, message: { mid: "m_1", text: "hola" } },
      ] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].accountId).toBe("17841453458089530");
    expect(out[0].channel).toBe("INSTAGRAM");
    expect(out[0].senderId).toBe("IGSID_123");
  });
});

describe("parseMessengerWebhook", () => {
  it("captura accountId desde entry.id (Page ID)", () => {
    const out = parseMessengerWebhook({
      object: "page",
      entry: [{ id: "103981554499114", messaging: [
        { sender: { id: "PSID_9" }, message: { mid: "m_2", text: "buenas" } },
      ] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].accountId).toBe("103981554499114");
    expect(out[0].channel).toBe("MESSENGER");
  });
});
