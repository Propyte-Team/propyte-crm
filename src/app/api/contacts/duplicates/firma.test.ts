import { describe, it, expect } from "vitest";
import { firmaDeGrupo } from "./firma";

describe("firmaDeGrupo", () => {
  it("no depende del orden ni de repetidos", () => {
    expect(firmaDeGrupo(["b", "a", "c"])).toBe(firmaDeGrupo(["c", "a", "b", "a"]));
  });
  it("cambia si el grupo gana un contacto", () => {
    expect(firmaDeGrupo(["a", "b"])).not.toBe(firmaDeGrupo(["a", "b", "c"]));
  });
});
