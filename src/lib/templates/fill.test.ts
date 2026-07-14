import { describe, it, expect } from "vitest";
import { fillTemplate, contactTemplateVars } from "./fill";

describe("fillTemplate (regla J.2)", () => {
  it("sustituye variables resueltas", () => {
    expect(fillTemplate("Hola {{contact.firstName}}, ¿cómo estás?", { "contact.firstName": "Ana" }))
      .toBe("Hola Ana, ¿cómo estás?");
  });

  it("elimina la línea completa si queda una variable sin resolver", () => {
    const body = "Hola {{contact.firstName}}\nTu asesor: {{user.name}}\nSaludos";
    expect(fillTemplate(body, { "contact.firstName": "Ana" })).toBe("Hola Ana\nSaludos");
  });

  it("variable con valor vacío o null cuenta como NO resuelta (se va la línea)", () => {
    const body = "Hola {{contact.firstName}}\nBienvenido";
    expect(fillTemplate(body, { "contact.firstName": "" })).toBe("Bienvenido");
    expect(fillTemplate(body, { "contact.firstName": null })).toBe("Bienvenido");
  });

  it("sin variables → texto intacto (trim)", () => {
    expect(fillTemplate("  Hola\n\n", {})).toBe("Hola");
  });

  it("múltiples ocurrencias de la misma variable", () => {
    expect(fillTemplate("{{n}} y {{n}}", { n: "x" })).toBe("x y x");
  });
});

describe("contactTemplateVars", () => {
  it("mapea nombre/apellido y limpia placeholders del intake", () => {
    expect(contactTemplateVars({ firstName: "Ana", lastName: "García" }))
      .toEqual({ "contact.firstName": "Ana", "contact.lastName": "García" });
    expect(contactTemplateVars({ firstName: "Messenger", lastName: "(por identificar)" }))
      .toEqual({ "contact.firstName": "Messenger", "contact.lastName": "" });
    expect(contactTemplateVars({ firstName: "Ana", lastName: "(sin apellido)" })["contact.lastName"]).toBe("");
  });
});
