import { describe, it, expect } from "vitest";
import { parseMessengerWebhook } from "./messenger";

describe("parseMessengerWebhook", () => {
  it("extrae IncomingMessage de un evento messaging de page (Messenger)", () => {
    const payload = {
      object: "page",
      entry: [{ messaging: [{ sender: { id: "PSID-1" }, message: { mid: "mid-9", text: "buenas" } }] }],
    };
    expect(parseMessengerWebhook(payload)).toEqual([
      { channel: "MESSENGER", senderId: "PSID-1", externalMessageId: "mid-9", text: "buenas", mediaUrl: null },
    ]);
  });
  it("ignora echoes", () => {
    const payload = { object: "page", entry: [{ messaging: [{ sender: { id: "X" }, message: { mid: "m", text: "x", is_echo: true } }] }] };
    expect(parseMessengerWebhook(payload)).toEqual([]);
  });
});
