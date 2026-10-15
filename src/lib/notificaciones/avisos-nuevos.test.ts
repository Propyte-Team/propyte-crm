import { describe, it, expect } from "vitest"
import { avisosNuevos } from "./avisos-nuevos"

// #889 — la campana solo lanza el aviso emergente de lo que llegó desde la última revisión.

const n = (id: string, createdAt: string) => ({ id, createdAt })

describe("avisosNuevos", () => {
  it("primera revisión (al cargar la página): no avisa de lo que ya estaba, solo lo marca visto", () => {
    const r = avisosNuevos([n("b", "2026-10-15T16:08:00Z"), n("a", "2026-10-15T15:00:00Z")], null)
    expect(r.nuevos).toEqual([])
    expect(r.vistoHasta).toBe("2026-10-15T16:08:00Z")
  })

  it("primera revisión sin nada: lo siguiente que llegue sí es nuevo", () => {
    const r1 = avisosNuevos([], null)
    expect(r1.nuevos).toEqual([])
    const r2 = avisosNuevos([n("a", "2026-10-15T16:08:00Z")], r1.vistoHasta)
    expect(r2.nuevos.map((x) => x.id)).toEqual(["a"])
  })

  it("solo lo posterior a lo ya visto, del más viejo al más nuevo", () => {
    const visto = "2026-10-15T16:00:00Z"
    const r = avisosNuevos(
      [n("c", "2026-10-15T16:09:00Z"), n("b", "2026-10-15T16:05:00Z"), n("a", "2026-10-15T15:59:00Z")],
      visto,
    )
    expect(r.nuevos.map((x) => x.id)).toEqual(["b", "c"])
    expect(r.vistoHasta).toBe("2026-10-15T16:09:00Z")
  })

  it("la misma notificación no avisa dos veces en revisiones seguidas", () => {
    const items = [n("a", "2026-10-15T16:08:00Z")]
    const r1 = avisosNuevos(items, "2026-10-15T16:00:00Z")
    expect(r1.nuevos).toHaveLength(1)
    const r2 = avisosNuevos(items, r1.vistoHasta)
    expect(r2.nuevos).toEqual([])
  })

  it("si el asesor marcó todo como leído, la lista viene vacía y lo visto no retrocede", () => {
    const r = avisosNuevos([], "2026-10-15T16:08:00Z")
    expect(r).toEqual({ nuevos: [], vistoHasta: "2026-10-15T16:08:00Z" })
  })
})
