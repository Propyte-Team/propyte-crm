import { describe, it, expect } from "vitest";
import { botConfigUpdateSchema } from "./bot-config";

describe("botConfigUpdateSchema", () => {
  it("acepta una config válida", () => {
    const r = botConfigUpdateSchema.safeParse({
      botEnabled: true,
      tonePreset: "PROFESIONAL_CALIDO",
      autonomyLevel: "L2",
      model: "claude-sonnet-5",
      openerStyle: "WARM_NAME",
      maxLines: 4,
      dataGateStrict: true,
      escalationTriggers: ["queja", "apartar"],
      enabledChannels: ["WHATSAPP"],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza preset inválido", () => {
    expect(botConfigUpdateSchema.safeParse({ tonePreset: "NOPE" }).success).toBe(false);
  });

  it("rechaza modelo fuera de la allowlist", () => {
    expect(botConfigUpdateSchema.safeParse({ model: "gpt-4" }).success).toBe(false);
  });

  it("rechaza maxLines fuera de rango", () => {
    expect(botConfigUpdateSchema.safeParse({ maxLines: 99 }).success).toBe(false);
    expect(botConfigUpdateSchema.safeParse({ maxLines: 0 }).success).toBe(false);
  });
});
