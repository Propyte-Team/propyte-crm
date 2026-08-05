import { describe, it, expect } from "vitest";
import { renderTemplate, pickVariant } from "./template";

describe("renderTemplate", () => {
  it("sustituye {{usuario}}", () => {
    expect(renderTemplate("Hola {{usuario}}, te mando info", { usuario: "luisf" }))
      .toBe("Hola luisf, te mando info");
  });

  it("tolera espacios dentro de las llaves y repeticiones", () => {
    expect(renderTemplate("{{ usuario }} y {{usuario}}", { usuario: "ana" })).toBe("ana y ana");
  });

  it("sin usuario deja la frase legible, no la palabra 'undefined'", () => {
    expect(renderTemplate("Hola {{usuario}}, gracias", { usuario: null })).toBe("Hola, gracias");
  });

  it("deja intactas las variables que no conoce", () => {
    expect(renderTemplate("Hola {{otra}}", { usuario: "x" })).toBe("Hola {{otra}}");
  });

  it("no interpreta patrones de reemplazo especiales en el usuario ($&)", () => {
    expect(renderTemplate("Hola {{usuario}}, gracias", { usuario: "$&" })).toBe("Hola $&, gracias");
  });

  it("no interpreta patrones de reemplazo especiales en el usuario ($`)", () => {
    expect(renderTemplate("{{usuario}} y {{usuario}}", { usuario: "$`" })).toBe("$` y $`");
  });

  it("sin usuario y placeholder al inicio no deja coma colgante", () => {
    expect(renderTemplate("{{usuario}}, bienvenido a Propyte!", { usuario: null }))
      .toBe("bienvenido a Propyte!");
  });
});

describe("pickVariant", () => {
  it("rota en orden según los disparos previos", () => {
    const v = ["a", "b", "c"];
    expect(pickVariant(v, 0)).toBe("a");
    expect(pickVariant(v, 1)).toBe("b");
    expect(pickVariant(v, 3)).toBe("a");
  });

  it("con una sola variante siempre devuelve esa", () => {
    expect(pickVariant(["solo"], 7)).toBe("solo");
  });

  it("lista vacía devuelve null", () => {
    expect(pickVariant([], 0)).toBeNull();
  });

  it("firedCount no entero (NaN) devuelve null, no undefined", () => {
    expect(pickVariant(["a", "b"], NaN)).toBeNull();
  });
});
