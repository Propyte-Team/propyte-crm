import { describe, it, expect } from "vitest"
import { z } from "zod"
import { mensajeDeError, erroresPorCampo, leerError } from "./api-errors"

// Genera un flatten real de zod 4 para no adivinar el texto de los mensajes
function flatten(schema: z.ZodType, input: unknown) {
  const r = schema.safeParse(input)
  if (r.success) throw new Error("se esperaba fallo")
  return z.flattenError(r.error)
}

describe("mensajeDeError", () => {
  it("devuelve el string de error tal cual", () => {
    expect(mensajeDeError({ error: "Correo duplicado" })).toBe("Correo duplicado")
  })

  it("usa fallback con formatos desconocidos", () => {
    expect(mensajeDeError(null)).toBe("No se pudo guardar")
    expect(mensajeDeError({}, "Falló")).toBe("Falló")
    expect(mensajeDeError({ error: "" }, "Falló")).toBe("Falló")
  })

  it("traduce un flatten real de zod 4", () => {
    const schema = z.object({
      name: z.string().min(3),
      email: z.string().email(),
      leaderId: z.string().uuid(),
      priority: z.number(),
      apiName: z.string(),
    })
    const data = { error: flatten(schema, { name: "a", email: "x", leaderId: "1", priority: "z" }) }
    const msg = mensajeDeError(data)
    expect(msg).toContain("Nombre: Debe tener al menos 3 caracteres")
    expect(msg).toContain("Correo: Correo no válido")
    expect(msg).toContain("Líder: Identificador no válido")
    expect(msg).toContain("Prioridad: Debe ser un número")
    expect(msg).toContain("Nombre técnico: Campo obligatorio")
    expect(msg).toContain(" · ")
    expect(msg).not.toMatch(/Invalid|Too small|expected/)
  })

  it("deja el nombre crudo si el campo no está en el diccionario y conserva formErrors", () => {
    const schema = z.object({ rareField: z.string() })
    const data = { error: flatten(schema, { rareField: 1 }) }
    expect(mensajeDeError(data)).toContain("rareField: Debe ser texto")
    const soloForm = { error: { formErrors: ["Algo global"], fieldErrors: {} } }
    expect(mensajeDeError(soloForm)).toBe("Algo global")
  })
})

describe("erroresPorCampo", () => {
  it("devuelve el primer mensaje traducido por campo", () => {
    const schema = z.object({ name: z.string().min(2), phone: z.string() })
    const out = erroresPorCampo({ error: flatten(schema, { name: "a" }) })
    expect(out.name).toBe("Debe tener al menos 2 caracteres")
    expect(out.phone).toBe("Campo obligatorio")
  })
  it("devuelve {} con string o basura", () => {
    expect(erroresPorCampo({ error: "x" })).toEqual({})
    expect(erroresPorCampo(undefined)).toEqual({})
  })
})

describe("leerError", () => {
  it("lee el JSON de la respuesta", async () => {
    const res = new Response(JSON.stringify({ error: "No autorizado" }), { status: 403 })
    expect(await leerError(res)).toBe("No autorizado")
  })
  it("tolera cuerpo no JSON", async () => {
    expect(await leerError(new Response("<html>", { status: 500 }), "Error del servidor")).toBe("Error del servidor")
  })
})
