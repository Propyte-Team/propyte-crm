import { describe, it, expect } from "vitest";
import { normalize, containsPhrase, matchRule, type CommentRuleLike } from "./match";

function rule(over: Partial<CommentRuleLike> = {}): CommentRuleLike {
  return {
    id: "r1",
    priority: 100,
    phrases: ["info"],
    postFilter: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

describe("normalize", () => {
  it("baja a minúsculas, quita acentos y colapsa espacios", () => {
    expect(normalize("  QUIERO   Información ÁÉÍ  ")).toBe("quiero informacion aei");
  });
});

describe("containsPhrase", () => {
  it("acepta la palabra con puntuación, emoji o mayúsculas alrededor", () => {
    for (const text of ["info", "Info!!", "¿info?", "info 🙏", "mas info por favor", "info,"]) {
      expect(containsPhrase(normalize(text), "info"), text).toBe(true);
    }
  });

  it("NO dispara cuando la palabra está dentro de otra", () => {
    for (const text of ["informal", "información", "reinfo", "infowars"]) {
      expect(containsPhrase(normalize(text), "info"), text).toBe(false);
    }
  });

  it("frase de varias palabras funciona con límites en los extremos", () => {
    expect(containsPhrase(normalize("Hola, QUIERO INFO ya"), "quiero info")).toBe(true);
    expect(containsPhrase(normalize("quiero informacion"), "quiero info")).toBe(false);
  });

  it("frase vacía nunca dispara", () => {
    expect(containsPhrase("info", "")).toBe(false);
  });

  it("no interpreta la frase como regex", () => {
    expect(containsPhrase(normalize("precio (2 recamaras)"), "(2 recamaras)")).toBe(true);
  });
});

describe("matchRule", () => {
  it("devuelve la regla y la frase que coincidió", () => {
    const out = matchRule([rule({ phrases: ["precios", "info"] })], "mándame INFO", "POST-1");
    expect(out).toEqual({ rule: expect.objectContaining({ id: "r1" }), phrase: "info" });
  });

  it("sin coincidencia devuelve null", () => {
    expect(matchRule([rule()], "qué bonito", "POST-1")).toBeNull();
  });

  it("gana la de menor priority", () => {
    const out = matchRule(
      [rule({ id: "baja", priority: 100 }), rule({ id: "alta", priority: 10 })],
      "info",
      "POST-1"
    );
    expect(out?.rule.id).toBe("alta");
  });

  it("con igual priority gana la más antigua", () => {
    const out = matchRule(
      [
        rule({ id: "nueva", createdAt: new Date("2026-06-01T00:00:00Z") }),
        rule({ id: "vieja", createdAt: new Date("2026-01-01T00:00:00Z") }),
      ],
      "info",
      "POST-1"
    );
    expect(out?.rule.id).toBe("vieja");
  });

  it("postFilter vacío aplica a toda la cuenta", () => {
    expect(matchRule([rule({ postFilter: [] })], "info", "CUALQUIERA")).not.toBeNull();
  });

  it("postFilter con IDs solo aplica a esas publicaciones", () => {
    const rules = [rule({ postFilter: ["POST-A"] })];
    expect(matchRule(rules, "info", "POST-A")).not.toBeNull();
    expect(matchRule(rules, "info", "POST-B")).toBeNull();
  });

  it("no muta el arreglo de reglas que recibe", () => {
    const rules = [rule({ id: "b", priority: 200 }), rule({ id: "a", priority: 1 })];
    matchRule(rules, "info", "POST-1");
    expect(rules.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
