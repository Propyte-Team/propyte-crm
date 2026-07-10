import { describe, it, expect } from "vitest";
import { TONE_PRESETS, getTonePreset } from "./tone-presets";

const KEYS = ["PROFESIONAL_CALIDO", "CALIDO_CERCANO_MX", "EJECUTIVO_SOBRIO", "NEUTRO_DIRECTO"] as const;

describe("tone-presets", () => {
  it("define los 4 presets con la forma esperada", () => {
    for (const k of KEYS) {
      const p = TONE_PRESETS[k];
      expect(p.key).toBe(k);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.voiceGuidance.length).toBeGreaterThan(40);
      expect(p.fewShot.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("PROFESIONAL_CALIDO trae al menos 3 ejemplos few-shot bien formados", () => {
    const p = TONE_PRESETS.PROFESIONAL_CALIDO;
    expect(p.fewShot.length).toBeGreaterThanOrEqual(3);
    for (const ex of p.fewShot) {
      expect(["user", "assistant"]).toContain(ex.role);
      expect(ex.content.trim().length).toBeGreaterThan(0);
    }
  });

  it("los presets sobrios no usan emoji", () => {
    const emoji = /[\uD800-\uDFFF]/;
    for (const k of ["PROFESIONAL_CALIDO", "EJECUTIVO_SOBRIO", "NEUTRO_DIRECTO"] as const) {
      const p = TONE_PRESETS[k];
      const text = p.voiceGuidance + p.fewShot.map((e) => e.content).join(" ");
      expect(emoji.test(text)).toBe(false);
    }
  });

  it("getTonePreset devuelve el preset y cae al default si la clave es inválida", () => {
    expect(getTonePreset("EJECUTIVO_SOBRIO").key).toBe("EJECUTIVO_SOBRIO");
    expect(getTonePreset("NO_EXISTE").key).toBe("PROFESIONAL_CALIDO");
  });
});
