import { describe, it, expect } from "vitest";
import { toMessageChannel, identifierFor } from "./channel";

describe("toMessageChannel", () => {
  it("traduce los canales soportados", () => {
    expect(toMessageChannel("INSTAGRAM")).toBe("INSTAGRAM");
    expect(toMessageChannel("MESSENGER")).toBe("MESSENGER");
    expect(toMessageChannel("WHATSAPP")).toBe("WHATSAPP");
    expect(toMessageChannel("SMS")).toBe("SMS");
  });

  it("devuelve null para WEB, que no tiene remitente bloqueable", () => {
    expect(toMessageChannel("WEB")).toBeNull();
  });
});

describe("identifierFor", () => {
  const contacto = { instagramId: "IGSID-1", messengerPsid: "PSID-1", phone: "+5219981234567" };

  it("elige el campo del canal", () => {
    expect(identifierFor("INSTAGRAM", contacto)).toBe("IGSID-1");
    expect(identifierFor("MESSENGER", contacto)).toBe("PSID-1");
    expect(identifierFor("WHATSAPP", contacto)).toBe("+5219981234567");
  });

  it("devuelve null si el contacto no tiene ese identificador", () => {
    expect(identifierFor("INSTAGRAM", { instagramId: null, messengerPsid: "PSID-1", phone: null })).toBeNull();
  });

  it("devuelve null para SMS, que se identifica por teléfono pero no se bloquea en Meta", () => {
    expect(identifierFor("SMS", contacto)).toBeNull();
  });
});
