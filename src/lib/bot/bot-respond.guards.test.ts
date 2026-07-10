import { describe, it, expect } from "vitest";
import { shouldBotRespondForChannel, buildOpener } from "./bot-respond";
import { DEFAULT_BOT_CONFIG } from "./config";

describe("shouldBotRespondForChannel", () => {
  it("respeta el master switch", () => {
    expect(shouldBotRespondForChannel({ ...DEFAULT_BOT_CONFIG, botEnabled: false }, "WHATSAPP")).toBe(false);
  });
  it("respeta los canales habilitados", () => {
    expect(shouldBotRespondForChannel(DEFAULT_BOT_CONFIG, "WHATSAPP")).toBe(true);
    expect(shouldBotRespondForChannel(DEFAULT_BOT_CONFIG, "INSTAGRAM")).toBe(false);
  });
});

describe("buildOpener", () => {
  it("WARM_NAME usa el nombre del contacto", () => {
    const o = buildOpener({ ...DEFAULT_BOT_CONFIG, openerStyle: "WARM_NAME" }, { firstName: "Ana", preferredZone: "Tulum" });
    expect(o).toContain("Ana");
    expect(o).toContain("Tulum");
  });
  it("DIRECT es más escueto y no exige nombre", () => {
    const o = buildOpener({ ...DEFAULT_BOT_CONFIG, openerStyle: "DIRECT" }, { firstName: "Ana", preferredZone: null });
    expect(o.length).toBeGreaterThan(0);
  });
  it("incluye el goal cuando se pasa", () => {
    const o = buildOpener({ ...DEFAULT_BOT_CONFIG, openerStyle: "WARM_NAME" }, { firstName: "Ana", preferredZone: "Tulum" }, "reactivacion");
    expect(o).toContain("reactivacion");
  });
});
