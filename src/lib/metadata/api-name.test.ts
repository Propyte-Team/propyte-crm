import { describe, it, expect } from "vitest";
import { slugDeEtiqueta, generarApiName, construirOpciones, opcionesDeTexto } from "./api-name";
import { validateApiName } from "./governance";

describe("slugDeEtiqueta", () => {
  it("minúsculas, sin acentos y con guiones bajos", () => {
    expect(slugDeEtiqueta("Notaría  Asignada #2")).toBe("notaria_asignada_2");
    expect(slugDeEtiqueta("  Año de compra ")).toBe("ano_de_compra");
  });
  it("texto sin caracteres válidos → vacío", () => {
    expect(slugDeEtiqueta("¿¿??")).toBe("");
  });
});

describe("generarApiName", () => {
  it("agrega el prefijo del módulo", () => {
    expect(generarApiName("contact", "Referido por", [])).toBe("contact_referido_por");
    expect(generarApiName("deal", "Notaría", [])).toBe("deal_notaria");
  });
  it("sufijo _2, _3 si choca", () => {
    expect(generarApiName("contact", "Notaría", ["contact_notaria"])).toBe("contact_notaria_2");
    expect(generarApiName("contact", "Notaría", ["contact_notaria", "contact_notaria_2"])).toBe("contact_notaria_3");
  });
  it("etiqueta vacía o que empieza con número produce un nombre válido", () => {
    expect(generarApiName("contact", "", [])).toBe("contact_campo");
    expect(generarApiName("contact", "2024 ventas", [])).toBe("contact_campo_2024_ventas");
  });
  it("evita nombres reservados", () => {
    expect(generarApiName("contact", "Id", [])).toBe("contact_id_campo");
  });
  it("respeta el máximo de 60 caracteres incluso con sufijo", () => {
    const largo = "x".repeat(100);
    const a = generarApiName("contact", largo, []);
    expect(a.length).toBeLessThanOrEqual(60);
    const b = generarApiName("contact", largo, [a]);
    expect(b.length).toBeLessThanOrEqual(60);
    expect(b).not.toBe(a);
    expect(b.endsWith("_2")).toBe(true);
  });
  it("siempre pasa validateApiName", () => {
    for (const et of ["Notaría", "", "123", "Id", "Año — de compra", "a".repeat(90)]) {
      const n = generarApiName("contact", et, []);
      expect(validateApiName("contact", n).ok).toBe(true);
    }
  });
});

describe("construirOpciones", () => {
  it("genera value sin acentos y único para las nuevas", () => {
    expect(construirOpciones([{ label: "Notaría 1" }, { label: "Notaria 1" }])).toEqual([
      { value: "notaria_1", label: "Notaría 1" },
      { value: "notaria_1_2", label: "Notaria 1" },
    ]);
  });
  it("conserva el value de las existentes aunque cambie la etiqueta", () => {
    const r = construirOpciones([{ value: "notaría_1", label: "Notaría Uno" }, { label: "Otra" }]);
    expect(r[0]).toEqual({ value: "notaría_1", label: "Notaría Uno" });
    expect(r[1].value).toBe("otra");
  });
  it("quita filas vacías", () => {
    expect(construirOpciones([{ label: "  " }, { label: "A" }])).toHaveLength(1);
  });
  it("opcionesDeTexto separa por coma", () => {
    expect(construirOpciones(opcionesDeTexto("Notaría 1, Notaría 7, "))).toHaveLength(2);
  });
});
