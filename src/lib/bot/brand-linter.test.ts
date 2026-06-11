import { describe, it, expect } from "vitest";
import { lintBrandVoice } from "./brand-linter";

describe("brand linter (voz Sage, §6.0)", () => {
  it("bloquea frases prohibidas", () => {
    expect(lintBrandVoice("Es una oportunidad única en el paraíso").ok).toBe(false);
    expect(lintBrandVoice("Plusvalía garantizada del 20%").ok).toBe(false);
    expect(lintBrandVoice("¡Últimas unidades, solo HOY!").ok).toBe(false);
  });
  it("reporta qué frases encontró", () => {
    const r = lintBrandVoice("oportunidad única y plusvalía garantizada");
    expect(r.ok).toBe(false);
    expect(r.violations).toContain("oportunidad única");
    expect(r.violations).toContain("plusvalía garantizada");
  });
  it("acepta texto data-grounded normal", () => {
    const r = lintBrandVoice(
      "Hola Juan, el desarrollo tiene unidades de 2 recámaras desde $3.2M MXN según el catálogo. ¿Te comparto la ficha?"
    );
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });
  it("es case-insensitive y tolera acentos", () => {
    expect(lintBrandVoice("PLUSVALIA GARANTIZADA").ok).toBe(false);
    expect(lintBrandVoice("Oportunidad Única").ok).toBe(false);
  });
});
