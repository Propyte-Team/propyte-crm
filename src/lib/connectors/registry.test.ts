import { describe, it, expect } from "vitest";
import { PROVIDERS, providerById, pullProviders } from "./registry";

describe("registry de proveedores", () => {
  it("tiene los 7 grupos esperados", () => {
    const ids = PROVIDERS.map((p) => p.id);
    for (const id of ["META", "INSTAGRAM", "TIKTOK", "GOOGLE_ADS", "LINKEDIN", "YOUTUBE", "PINTEREST"]) {
      expect(ids).toContain(id);
    }
  });
  it("YouTube y Pinterest son push-only (pull none)", () => {
    expect(providerById("YOUTUBE")?.pull).toBe("none");
    expect(providerById("PINTEREST")?.pull).toBe("none");
  });
  it("pullProviders excluye los push-only", () => {
    const ids = pullProviders().map((p) => p.id);
    expect(ids).not.toContain("YOUTUBE");
    expect(ids).not.toContain("PINTEREST");
    expect(ids).toContain("META");
  });
  it("cada proveedor con pull declara credFields y al menos un wizardStep", () => {
    for (const p of pullProviders()) {
      expect(p.credFields.length).toBeGreaterThan(0);
      expect(p.wizardSteps.length).toBeGreaterThan(0);
    }
  });
});
