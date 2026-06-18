import { describe, it, expect } from "vitest";
import { parseInstagramWebhook } from "./instagram";

describe("parseInstagramWebhook", () => {
  it("extrae IncomingMessage de un evento messaging de IG", () => {
    const payload = {
      object: "instagram",
      entry: [{ messaging: [{ sender: { id: "IGSID-1" }, message: { mid: "mid-1", text: "hola" } }] }],
    };
    const out = parseInstagramWebhook(payload);
    expect(out).toEqual([
      { channel: "INSTAGRAM", senderId: "IGSID-1", externalMessageId: "mid-1", text: "hola", mediaUrl: null },
    ]);
  });
  it("ignora echoes (mensajes salientes propios) y eventos sin message", () => {
    const payload = {
      object: "instagram",
      entry: [{ messaging: [{ sender: { id: "X" }, message: { mid: "m", text: "x", is_echo: true } }, { sender: { id: "Y" }, read: {} }] }],
    };
    expect(parseInstagramWebhook(payload)).toEqual([]);
  });
});
