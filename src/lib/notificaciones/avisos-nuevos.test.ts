import { describe, it, expect } from "vitest"
import {
  avisosNuevos,
  TIPOS_AVISO_EMERGENTE,
  asignacionesPendientesAlEntrar,
  avisarEnNavegador,
  debeRevisar,
} from "./avisos-nuevos"

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

// ------------------------------------------------------------
// #915: asignaciones en la campana
// ------------------------------------------------------------
describe("campana: asignaciones (#915)", () => {
  it("el aviso emergente cubre correo y las cuatro asignaciones", () => {
    expect([...TIPOS_AVISO_EMERGENTE].sort()).toEqual(
      ["conversation_assigned", "deal_assigned", "email_inbound", "lead_assigned", "task_assigned"],
    )
  })

  it("con la pestaña oculta solo pregunta si el navegador puede mostrar el aviso", () => {
    expect(debeRevisar(false, null)).toBe(true)
    expect(debeRevisar(false, "denied")).toBe(true)
    expect(debeRevisar(true, "granted")).toBe(true)
    expect(debeRevisar(true, "default")).toBe(false)
    expect(debeRevisar(true, null)).toBe(false)
  })

  it("el aviso del navegador es solo con la pestaña oculta y permiso concedido", () => {
    expect(avisarEnNavegador(true, "granted")).toBe(true)
    expect(avisarEnNavegador(false, "granted")).toBe(false)
    expect(avisarEnNavegador(true, "denied")).toBe(false)
  })

  it("al entrar, las asignaciones sin ver (no el correo), de la más nueva a la más vieja", () => {
    const items = [
      { id: "1", type: "task_assigned", createdAt: "2026-10-20T10:00:00Z" },
      { id: "2", type: "email_inbound", createdAt: "2026-10-20T12:00:00Z" },
      { id: "3", type: "conversation_assigned", createdAt: "2026-10-20T11:00:00Z" },
      { id: "4", type: "sla_breach", createdAt: "2026-10-20T13:00:00Z" },
    ]
    expect(asignacionesPendientesAlEntrar(items).map((n) => n.id)).toEqual(["3", "1"])
  })
})
