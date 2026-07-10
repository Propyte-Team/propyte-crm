import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildClaudeRequestBody, thinkingFieldFor } from "./claude";
import { DEFAULT_BOT_CONFIG } from "./config";
import { TONE_PRESETS } from "./tone-presets";

const contact = { firstName: "Juan", preferredLanguage: "ES" };

describe("buildSystemPrompt (4 capas)", () => {
  it("incluye reglas de marca (anti-hype + data-gate + escalamiento)", () => {
    const s = buildSystemPrompt({ config: DEFAULT_BOT_CONFIG, contact, catalog: [] });
    expect(s).toContain("Propyte");
    expect(s.toLowerCase()).toContain("no inventes");
    expect(s).toContain("[ESCALAR]");
  });

  it("incluye la guía de voz del preset activo", () => {
    const s = buildSystemPrompt({
      config: { ...DEFAULT_BOT_CONFIG, tonePreset: "EJECUTIVO_SOBRIO" },
      contact,
      catalog: [],
    });
    expect(s).toContain(TONE_PRESETS.EJECUTIVO_SOBRIO.voiceGuidance.slice(0, 30));
  });

  it("refleja maxLines", () => {
    const s = buildSystemPrompt({ config: { ...DEFAULT_BOT_CONFIG, maxLines: 2 }, contact, catalog: [] });
    expect(s).toContain("2 líneas");
  });

  it("dataGateStrict=false suaviza la regla de cifras", () => {
    const strict = buildSystemPrompt({ config: { ...DEFAULT_BOT_CONFIG, dataGateStrict: true }, contact, catalog: [] });
    const loose = buildSystemPrompt({ config: { ...DEFAULT_BOT_CONFIG, dataGateStrict: false }, contact, catalog: [] });
    expect(strict).not.toBe(loose);
  });

  it("usa el objetivo dado (gancho del playbook) y si no, el default", () => {
    const withObj = buildSystemPrompt({ config: DEFAULT_BOT_CONFIG, contact, catalog: [], objective: "OBJETIVO_X" });
    expect(withObj).toContain("OBJETIVO_X");
    const def = buildSystemPrompt({ config: DEFAULT_BOT_CONFIG, contact, catalog: [] });
    expect(def.toLowerCase()).toContain("califica");
  });

  it("sin catálogo instruye a no citar precios", () => {
    const s = buildSystemPrompt({ config: DEFAULT_BOT_CONFIG, contact, catalog: [] });
    expect(s.toLowerCase()).toContain("no cites precios");
  });
});

describe("buildClaudeRequestBody", () => {
  it("Sonnet 5 lleva thinking:disabled y el modelo dado", () => {
    const body = buildClaudeRequestBody({
      model: "claude-sonnet-5",
      system: "S",
      messages: [{ role: "user", content: "hola" }],
      maxTokens: 300,
    }) as any;
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.max_tokens).toBe(300);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("Haiku 4.5 NO manda thinking (no pertenece a la familia 4.6+)", () => {
    expect(thinkingFieldFor("claude-haiku-4-5")).toEqual({});
    const body = buildClaudeRequestBody({
      model: "claude-haiku-4-5",
      system: "S",
      messages: [{ role: "user", content: "hola" }],
      maxTokens: 300,
    }) as any;
    expect(body.thinking).toBeUndefined();
  });

  it("Fable 5 omite thinking (rechaza disabled con 400)", () => {
    expect(thinkingFieldFor("claude-fable-5")).toEqual({});
  });
});
