import { describe, it, expect } from "vitest";
import {
  agregarTema, alternarDisparador, etiquetaDisparador, quitarTema, temasPersonalizados, MAX_DISPARADORES,
} from "./bot-escalamiento";

describe("bot-escalamiento", () => {
  it("alterna sin tocar los demás ni duplicar", () => {
    expect(alternarDisparador(["queja"], "apartar", true)).toEqual(["queja", "apartar"]);
    expect(alternarDisparador(["queja", "apartar"], "apartar", true)).toEqual(["queja", "apartar"]);
    expect(alternarDisparador(["queja", "apartar"], "queja", false)).toEqual(["apartar"]);
  });

  it("etiqueta en español para los de fábrica y el texto tal cual para los demás", () => {
    expect(etiquetaDisparador("legal_fiscal")).toBe("Pregunta por temas legales o fiscales");
    expect(etiquetaDisparador("pide hablar con una persona")).toBe("pide hablar con una persona");
  });

  it("separa los temas personalizados", () => {
    expect(temasPersonalizados(["queja", "quiere factura", "apartar"])).toEqual(["quiere factura"]);
  });

  it("agrega recortando espacios y rechaza vacíos, repetidos y excesos", () => {
    expect(agregarTema(["queja"], "  quiere   factura ")).toEqual({ ok: true, lista: ["queja", "quiere factura"] });
    expect(agregarTema([], "   ")).toMatchObject({ ok: false });
    expect(agregarTema(["Quiere factura"], "quiere factura")).toMatchObject({ ok: false });
    expect(agregarTema(["queja"], "Se queja o está molesto")).toMatchObject({ ok: false });
    expect(agregarTema(["a"], "x".repeat(81))).toMatchObject({ ok: false });
    expect(agregarTema(Array.from({ length: MAX_DISPARADORES }, (_, i) => `t${i}`), "otro")).toMatchObject({ ok: false });
  });

  it("quita un tema", () => {
    expect(quitarTema(["a", "b"], "a")).toEqual(["b"]);
  });
});
