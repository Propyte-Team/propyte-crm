import { describe, it, expect } from "vitest";
import { columnasVisibles } from "@/lib/agenda/columnas";
import { COLUMNAS_CONTACTOS } from "./columnas";

describe("COLUMNAS_CONTACTOS", () => {
  it("las claves no se repiten (una clave duplicada pintaría la columna dos veces)", () => {
    const keys = COLUMNAS_CONTACTOS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("Nombre es la única obligatoria: sin ella la fila no se reconoce", () => {
    expect(COLUMNAS_CONTACTOS.filter((c) => c.required).map((c) => c.key)).toEqual(["nombre"]);
  });

  it("sin preferencia guardada se ve lo de siempre MÁS el tipo de contacto, junto a Estado", () => {
    expect(columnasVisibles(COLUMNAS_CONTACTOS, null)).toEqual([
      "nombre",
      "estado",
      "tipo",
      "telefono",
      "email",
      "fuente",
      "temperatura",
      "asesor",
      "registro",
    ]);
  });

  it("ocultar columnas respeta el orden del catálogo y nunca quita Nombre", () => {
    expect(columnasVisibles(COLUMNAS_CONTACTOS, ["registro", "tipo"])).toEqual([
      "nombre",
      "tipo",
      "registro",
    ]);
  });

  it("una preferencia corrupta vuelve al default en vez de dejar la tabla vacía", () => {
    expect(columnasVisibles(COLUMNAS_CONTACTOS, "basura")).toContain("tipo");
    expect(columnasVisibles(COLUMNAS_CONTACTOS, ["no-existe"])).toContain("tipo");
  });
});
