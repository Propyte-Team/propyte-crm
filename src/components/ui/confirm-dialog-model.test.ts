import { describe, it, expect } from "vitest"
import { resolverOpciones } from "./confirm-dialog-model"

describe("resolverOpciones", () => {
  it("aplica los valores por defecto", () => {
    expect(resolverOpciones({ titulo: "¿Eliminar?" })).toEqual({
      titulo: "¿Eliminar?",
      descripcion: undefined,
      confirmar: "Confirmar",
      cancelar: "Cancelar",
      peligroso: false,
    })
  })
  it("respeta lo que se pasa y trata textos vacíos como ausentes", () => {
    const r = resolverOpciones({ titulo: "t", descripcion: "d", confirmar: "Eliminar", cancelar: " ", peligroso: true })
    expect(r).toMatchObject({ descripcion: "d", confirmar: "Eliminar", cancelar: "Cancelar", peligroso: true })
  })
})
