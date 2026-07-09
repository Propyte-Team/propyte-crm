import { describe, it, expect } from "vitest";
import { fieldMapSchema } from "./mapping-model";

describe("fieldMapSchema", () => {
  it("acepta legacy Record<string,string>", () => {
    expect(fieldMapSchema.safeParse({ full_name: "fullName" }).success).toBe(true);
  });
  it("acepta {} ", () => { expect(fieldMapSchema.safeParse({}).success).toBe(true); });
  it("acepta rich rules válidas", () => {
    expect(fieldMapSchema.safeParse({ rules: [{ source: "constant", value: "META_ADS", target: "source" }] }).success).toBe(true);
  });
  it("acepta target custom.*", () => {
    expect(fieldMapSchema.safeParse({ rules: [{ source: "question", metaField: "q", target: "custom.presupuesto" }] }).success).toBe(true);
  });
  it("rechaza target fuera de whitelist", () => {
    expect(fieldMapSchema.safeParse({ rules: [{ source: "question", metaField: "q", target: "ownerId" }] }).success).toBe(false);
  });
  it("rechaza source inválido", () => {
    expect(fieldMapSchema.safeParse({ rules: [{ source: "bogus", target: "email" }] }).success).toBe(false);
  });
});
