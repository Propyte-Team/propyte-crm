import { describe, expect, it } from "vitest"
import { formatoDuracion } from "./duracion"

describe("formatoDuracion", () => {
  it("muestra segundos en llamadas de menos de un minuto", () => {
    expect(formatoDuracion(12, 1)).toBe("12 s")
    expect(formatoDuracion(59, 1)).toBe("59 s")
  })
  it("muestra minutos y segundos sin redondear", () => {
    expect(formatoDuracion(61, 2)).toBe("1 min 01 s")
    expect(formatoDuracion(125, 3)).toBe("2 min 05 s")
    expect(formatoDuracion(120, 2)).toBe("2 min")
  })
  it("usa los minutos en filas viejas sin segundos", () => {
    expect(formatoDuracion(null, 3)).toBe("3 min")
    expect(formatoDuracion(undefined, 1)).toBe("1 min")
  })
  it("respeta los minutos editados a mano", () => {
    expect(formatoDuracion(12, 5)).toBe("5 min")
  })
  it("no muestra nada con duración cero o vacía", () => {
    expect(formatoDuracion(0, 0)).toBeNull()
    expect(formatoDuracion(null, null)).toBeNull()
  })
})
