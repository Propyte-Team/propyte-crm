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

  it("parsea el referral de anuncios cuando viene junto al mensaje (click-to-IG-DM sin Get Started)", () => {
    const out = parseInstagramWebhook({
      object: "instagram",
      entry: [{ messaging: [{
        sender: { id: "IGSID-ads" },
        message: { mid: "m-ads", text: "hola, vi el anuncio" },
        referral: { ref: "campana-verano", source: "ADS", type: "OPEN_THREAD", ad_id: "120210000000000" },
      }] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].referral).toEqual({ ref: "campana-verano", source: "ADS", type: "OPEN_THREAD", adId: "120210000000000" });
  });

  it("emite un IncomingMessage sintético para un postback sin message (Get Started con referral anidado)", () => {
    const out = parseInstagramWebhook({
      object: "instagram",
      entry: [{ id: "17841", messaging: [{
        sender: { id: "IGSID-gs" },
        timestamp: 1700000000000,
        postback: {
          title: "Get Started",
          payload: "PASSTHROUGH",
          referral: { ref: "campana-verano", source: "ADS", type: "OPEN_THREAD", ad_id: "120210000000001" },
        },
      }] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Get Started");
    expect(out[0].referral).toEqual({ ref: "campana-verano", source: "ADS", type: "OPEN_THREAD", adId: "120210000000001" });
    expect(out[0].accountId).toBe("17841");
    expect(out[0].mediaUrl).toBeNull();
    expect(out[0].externalMessageId).toBeTruthy();
  });

  it("postback sin title usa el payload como texto", () => {
    const out = parseInstagramWebhook({
      object: "instagram",
      entry: [{ messaging: [{ sender: { id: "IGSID-p" }, postback: { payload: "SOLO_PAYLOAD" } }] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("SOLO_PAYLOAD");
    expect(out[0].referral).toBeUndefined();
  });

  it("no emite mensaje para un evento de solo referral sin message ni postback", () => {
    const out = parseInstagramWebhook({
      object: "instagram",
      entry: [{ messaging: [{ sender: { id: "IGSID-r" }, referral: { source: "ADS" } }] }],
    });
    expect(out).toEqual([]);
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
