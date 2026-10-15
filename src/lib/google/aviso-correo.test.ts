import { describe, it, expect } from "vitest"
import { armarAvisoCorreo, contactoDelAviso, TIPO_AVISO_CORREO, VENTANA_AVISO_MS } from "./aviso-correo"

// #889 — el aviso que recibe el asesor cuando un cliente le contesta.

const C = "86cb4b82-27aa-41b9-bdce-61d1938117cf"
const ahora = new Date("2026-10-15T16:10:00Z")
const base = {
  userId: "asesor-1",
  contacto: { id: C, firstName: "Yair", lastName: "Guzman" },
  fromEmail: "yair@ekasa.mx",
  subject: "Re: Correo de prueba nyeheh",
  snippet: "Estimada Karla. Como te comentaba en el correo anterior…",
  fecha: new Date("2026-10-15T16:08:00Z"),
  ahora,
}

describe("armarAvisoCorreo", () => {
  it("dice quién escribió y el asunto, y lleva a la ficha del contacto", () => {
    expect(armarAvisoCorreo(base)).toEqual({
      userId: "asesor-1",
      title: "Correo de Yair Guzman",
      message: "Re: Correo de prueba nyeheh — Estimada Karla. Como te comentaba en el correo anterior…",
      type: TIPO_AVISO_CORREO,
      link: `/contacts/${C}`,
    })
  })

  it("sin nombre en la ficha usa el correo de quien escribió", () => {
    expect(armarAvisoCorreo({ ...base, contacto: { id: C } })?.title).toBe("Correo de yair@ekasa.mx")
  })

  it("sin asunto ni extracto no queda vacío", () => {
    expect(armarAvisoCorreo({ ...base, subject: "", snippet: "" })?.message).toBe("(sin asunto)")
  })

  it("recorta textos largos", () => {
    const a = armarAvisoCorreo({ ...base, subject: "x".repeat(200), snippet: "y".repeat(500) })!
    expect(a.message.length).toBeLessThanOrEqual(80 + 3 + 120)
  })

  it("un correo de hace más de 24 h no avisa (se registra, pero no hace sonar la campana)", () => {
    const viejo = new Date(ahora.getTime() - VENTANA_AVISO_MS - 1000)
    expect(armarAvisoCorreo({ ...base, fecha: viejo })).toBeNull()
    const justo = new Date(ahora.getTime() - VENTANA_AVISO_MS + 1000)
    expect(armarAvisoCorreo({ ...base, fecha: justo })).not.toBeNull()
  })
})

describe("contactoDelAviso", () => {
  it("saca el id del contacto del enlace del aviso", () => {
    expect(contactoDelAviso(`/contacts/${C}`)).toBe(C)
    expect(contactoDelAviso(`/contacts/${C}?tab=x`)).toBe(C)
  })
  it("otros enlaces → null", () => {
    expect(contactoDelAviso("/inbox?c=123")).toBeNull()
    expect(contactoDelAviso(null)).toBeNull()
    expect(contactoDelAviso(`/contacts/${C}extra`)).toBeNull()
  })
})
