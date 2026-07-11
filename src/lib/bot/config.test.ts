import { describe, it, expect } from "vitest";
import { resolveBotConfig, DEFAULT_BOT_CONFIG } from "./config";

describe("resolveBotConfig", () => {
  it("devuelve defaults cuando no hay fila", () => {
    const r = resolveBotConfig(null);
    expect(r.tonePreset).toBe(DEFAULT_BOT_CONFIG.tonePreset);
    expect(r.enabledChannels).toEqual(["WHATSAPP"]);
    expect(r.escalationTriggers.length).toBeGreaterThan(0);
    expect(r.model.length).toBeGreaterThan(0);
  });

  it("mapea una fila y parsea los Json a arrays de string", () => {
    const r = resolveBotConfig({
      botEnabled: false,
      tonePreset: "EJECUTIVO_SOBRIO",
      autonomyLevel: "L1",
      model: "claude-sonnet-4-6",
      openerStyle: "DIRECT",
      maxLines: 3,
      dataGateStrict: false,
      escalationTriggers: ["queja"],
      enabledChannels: ["WHATSAPP", "INSTAGRAM"],
    } as any);
    expect(r.botEnabled).toBe(false);
    expect(r.tonePreset).toBe("EJECUTIVO_SOBRIO");
    expect(r.openerStyle).toBe("DIRECT");
    expect(r.enabledChannels).toEqual(["WHATSAPP", "INSTAGRAM"]);
    expect(r.escalationTriggers).toEqual(["queja"]);
  });

  it("tolera Json corrupto cayendo al default de esa lista", () => {
    const r = resolveBotConfig({ escalationTriggers: "no-es-array", enabledChannels: null } as any);
    expect(r.escalationTriggers).toEqual(DEFAULT_BOT_CONFIG.escalationTriggers);
    expect(r.enabledChannels).toEqual(DEFAULT_BOT_CONFIG.enabledChannels);
  });
});

describe("resolveBotConfig activePlaybookId", () => {
  it("default null", () => {
    expect(resolveBotConfig(null).activePlaybookId).toBeNull();
  });
  it("mapea el id de la fila", () => {
    expect(resolveBotConfig({ activePlaybookId: "pb_1" } as any).activePlaybookId).toBe("pb_1");
  });
});
