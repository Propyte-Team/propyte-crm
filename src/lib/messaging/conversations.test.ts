import { describe, it, expect } from "vitest";
import { sameConversationKey } from "./conversations";

describe("sameConversationKey", () => {
  it("igual contacto+canal pero distinto connector → claves distintas", () => {
    expect(sameConversationKey(
      { contactId: "a", channel: "WHATSAPP", connectorId: "n1" },
      { contactId: "a", channel: "WHATSAPP", connectorId: "n2" },
    )).toBe(false);
  });
  it("mismo contacto+canal+connector → misma clave", () => {
    expect(sameConversationKey(
      { contactId: "a", channel: "WHATSAPP", connectorId: "n1" },
      { contactId: "a", channel: "WHATSAPP", connectorId: "n1" },
    )).toBe(true);
  });
  it("connector null en ambos → misma clave", () => {
    expect(sameConversationKey(
      { contactId: "a", channel: "WEB", connectorId: null },
      { contactId: "a", channel: "WEB", connectorId: null },
    )).toBe(true);
  });
});
