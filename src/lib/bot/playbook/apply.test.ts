import { describe, it, expect } from "vitest";
import { resolveWrite } from "./apply";

describe("resolveWrite", () => {
  it("nativo permitido", () => {
    expect(resolveWrite({ field: "budgetMax", value: 3000000 })).toEqual({ kind: "native", column: "budgetMax", value: 3000000 });
  });

  it("custom", () => {
    expect(resolveWrite({ field: "custom.color", value: "azul" })).toEqual({ kind: "custom", key: "color", value: "azul" });
  });

  it("campo no permitido → skip", () => {
    expect(resolveWrite({ field: "isAdmin", value: true })).toEqual({ kind: "skip", field: "isAdmin" });
  });
});
