import { describe, it, expect } from "vitest";
import { brandEnabledChannels } from "./settings";

describe("brandEnabledChannels", () => {
  it("null → hereda (null)", () => {
    expect(brandEnabledChannels({ enabledChannels: null })).toBeNull();
  });
  it("arreglo de strings → ese arreglo", () => {
    expect(brandEnabledChannels({ enabledChannels: ["WHATSAPP", "INSTAGRAM"] })).toEqual(["WHATSAPP", "INSTAGRAM"]);
  });
  it("JSON inválido (no arreglo, o con no-strings) → null (hereda, no revienta)", () => {
    expect(brandEnabledChannels({ enabledChannels: { a: 1 } as never })).toBeNull();
    expect(brandEnabledChannels({ enabledChannels: ["WHATSAPP", 3] as never })).toBeNull();
    expect(brandEnabledChannels({ enabledChannels: "WHATSAPP" as never })).toBeNull();
  });
});
