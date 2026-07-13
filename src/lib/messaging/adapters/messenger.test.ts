import { describe, it, expect } from "vitest";
import { parseMessengerWebhook } from "./messenger";

describe("parseMessengerWebhook", () => {
  it("extrae IncomingMessage de un evento messaging de page (Messenger)", () => {
    const payload = {
      object: "page",
      entry: [{ messaging: [{ sender: { id: "PSID-1" }, message: { mid: "mid-9", text: "buenas" } }] }],
    };
    expect(parseMessengerWebhook(payload)).toEqual([
      { channel: "MESSENGER", senderId: "PSID-1", externalMessageId: "mid-9", text: "buenas", mediaUrl: null, accountId: null },
    ]);
  });
  it("ignora echoes", () => {
    const payload = { object: "page", entry: [{ messaging: [{ sender: { id: "X" }, message: { mid: "m", text: "x", is_echo: true } }] }] };
    expect(parseMessengerWebhook(payload)).toEqual([]);
  });

  it("parsea el referral de anuncios (click-to-Messenger sin Get Started) junto al mensaje", () => {
    const out = parseMessengerWebhook({
      object: "page",
      entry: [{ messaging: [{
        sender: { id: "PSID-ads" },
        message: { mid: "m-ads", text: "hola" },
        referral: { ref: "campana-verano", source: "ADS", type: "OPEN_THREAD", ad_id: "120210000000002" },
      }] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].referral).toEqual({ ref: "campana-verano", source: "ADS", type: "OPEN_THREAD", adId: "120210000000002" });
  });

  it("emite un IncomingMessage sintético para postback 'Get Started' con referral anidado", () => {
    const out = parseMessengerWebhook({
      object: "page",
      entry: [{ id: "103981554499114", messaging: [{
        sender: { id: "PSID-gs" },
        timestamp: 1700000000001,
        postback: {
          title: "Get Started",
          payload: "PASSTHROUGH",
          referral: { source: "ADS", type: "OPEN_THREAD", ad_id: "120210000000003" },
        },
      }] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Get Started");
    expect(out[0].referral).toEqual({ source: "ADS", type: "OPEN_THREAD", adId: "120210000000003" });
    expect(out[0].channel).toBe("MESSENGER");
  });

  it("postback sin title ni payload no revienta y usa fallback de texto", () => {
    const out = parseMessengerWebhook({
      object: "page",
      entry: [{ messaging: [{ sender: { id: "PSID-p" }, postback: {} }] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("[postback]");
  });

  it("no emite mensaje para un evento de solo referral sin message ni postback", () => {
    const out = parseMessengerWebhook({
      object: "page",
      entry: [{ messaging: [{ sender: { id: "PSID-r" }, referral: { source: "SHORTLINK" } }] }],
    });
    expect(out).toEqual([]);
  });
});
