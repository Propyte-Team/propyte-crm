import { describe, it, expect } from "vitest"
import { filtrarAsesores, mostrarFiltroAsesores, normalizar } from "./filtro-asesores"

// #919: la búsqueda dentro del filtro «Asesores».
const LISTA = [
  { id: "1", name: "Victor Arroyo" },
  { id: "2", name: "Ignacio Lencinas" },
  { id: "3", name: "Sonia Cervantes" },
  { id: "4", name: "Felipe Luksic" },
]

describe("filtrarAsesores", () => {
  it("sin texto devuelve todos", () => {
    expect(filtrarAsesores(LISTA, "  ")).toHaveLength(4)
  })

  it("ignora mayúsculas y acentos", () => {
    expect(filtrarAsesores(LISTA, "VÍCTOR").map((a) => a.id)).toEqual(["1"])
    expect(normalizar("Ñandú Pérez")).toBe("nandu perez")
  })

  it("busca por apellido y por pedazos de palabra", () => {
    expect(filtrarAsesores(LISTA, "cerv").map((a) => a.id)).toEqual(["3"])
  })

  it("varias palabras: todas tienen que estar, en cualquier orden", () => {
    expect(filtrarAsesores(LISTA, "luksic fel").map((a) => a.id)).toEqual(["4"])
    expect(filtrarAsesores(LISTA, "victor sonia")).toEqual([])
  })
})

describe("mostrarFiltroAsesores", () => {
  it("un asesor que solo ve lo suyo no lo necesita", () => {
    expect(mostrarFiltroAsesores([{}], 0)).toBe(false)
  })

  it("con dos dueños o con contactos sin asignar, sí", () => {
    expect(mostrarFiltroAsesores([{}, {}], 0)).toBe(true)
    expect(mostrarFiltroAsesores([{}], 3)).toBe(true)
  })
})
