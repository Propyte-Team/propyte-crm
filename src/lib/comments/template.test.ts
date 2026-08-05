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

  it("sin usuario, multilinea: conserva la sangria intencional de otros parrafos", () => {
    expect(renderTemplate("Hola {{usuario}},\n\n  Gracias por tu comentario.", { usuario: null }))
      .toBe("Hola,\n\n  Gracias por tu comentario.");
  });

  it("sin usuario, placeholder solo en la primera linea: no deja lineas en blanco al inicio", () => {
    expect(renderTemplate("{{usuario}}\n\nSegunda linea", { usuario: null }))
      .toBe("Segunda linea");
  });

  it("con usuario, multilinea: solo sustituye el nombre, conserva el espaciado intencional", () => {
    expect(renderTemplate("Hola {{usuario}},\n\n  Gracias por tu comentario.", { usuario: "ana" }))
      .toBe("Hola ana,\n\n  Gracias por tu comentario.");
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
