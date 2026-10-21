import { describe, it, expect } from "vitest"
import {
  asignablesWhere,
  nivelAsignacion,
  puedeAsignarTareaA,
  type ActorAsignacion,
  type DestinoAsignacion,
} from "./asignacion"

// #915: quién le puede asignar una tarea a quién. Regla de sistemas@ (2026-10-20/21):
// ADMIN y DIRECTOR → cualquier asesor; GERENTE → los asesores de su plaza; TEAM_LEADER → los de
// su equipo; cualquier otro → solo a sí mismo.

const USUARIOS: DestinoAsignacion[] = [
  { id: "ase-pdc-tl1", role: "ASESOR", plaza: "PDC", teamLeaderId: "tl-1", isActive: true, email: "a@propyte.com" },
  { id: "jr-pdc-tl1", role: "ASESOR_JR", plaza: "PDC", teamLeaderId: "tl-1", isActive: true, email: "b@propyte.com" },
  { id: "sr-pdc-tl2", role: "ASESOR_SR", plaza: "PDC", teamLeaderId: "tl-2", isActive: true, email: "c@propyte.com" },
  { id: "ase-tulum", role: "ASESOR", plaza: "TULUM", teamLeaderId: null, isActive: true, email: "d@propyte.com" },
  { id: "ase-baja", role: "ASESOR", plaza: "PDC", teamLeaderId: "tl-1", isActive: false, email: "e@propyte.com" },
  { id: "ase-borrado", role: "ASESOR", plaza: "PDC", teamLeaderId: "tl-1", isActive: true, deletedAt: new Date(), email: "f@propyte.com" },
  { id: "ase-local", role: "ASESOR", plaza: "PDC", teamLeaderId: "tl-1", isActive: true, email: "agentes@propyte.local" },
  { id: "tl-2", role: "TEAM_LEADER", plaza: "PDC", teamLeaderId: null, isActive: true, email: "g@propyte.com" },
  { id: "ger-tulum", role: "GERENTE", plaza: "TULUM", teamLeaderId: null, isActive: true, email: "h@propyte.com" },
  { id: "hostess", role: "HOSTESS", plaza: "PDC", teamLeaderId: "tl-1", isActive: true, email: "i@propyte.com" },
  { id: "broker", role: "BROKER", plaza: "PDC", teamLeaderId: "tl-1", isActive: true, email: "j@propyte.com" },
]

const ADMIN: ActorAsignacion = { id: "admin", role: "ADMIN", plaza: "PDC" }
const DIRECTOR: ActorAsignacion = { id: "dir", role: "DIRECTOR", plaza: "PDC" }
const GERENTE_PDC: ActorAsignacion = { id: "ger-pdc", role: "GERENTE", plaza: "PDC" }
const GERENTE_SIN_PLAZA: ActorAsignacion = { id: "ger-x", role: "GERENTE", plaza: null }
const TL1: ActorAsignacion = { id: "tl-1", role: "TEAM_LEADER", plaza: "PDC" }
const ASESOR: ActorAsignacion = { id: "ase-pdc-tl1", role: "ASESOR", plaza: "PDC" }

function asignablesPor(actor: ActorAsignacion): string[] {
  return USUARIOS.filter((u) => u.id !== actor.id && puedeAsignarTareaA(actor, u)).map((u) => u.id).sort()
}

const ATENDIBLES = ["ase-pdc-tl1", "jr-pdc-tl1", "sr-pdc-tl2", "ase-tulum"]

describe("puedeAsignarTareaA — la tabla de sistemas@", () => {
  it("ADMIN y DIRECTOR: cualquier asesor atendible, de cualquier plaza", () => {
    expect(asignablesPor(ADMIN)).toEqual([...ATENDIBLES].sort())
    expect(asignablesPor(DIRECTOR)).toEqual([...ATENDIBLES].sort())
  })

  it("GERENTE: solo los asesores de SU plaza", () => {
    expect(asignablesPor(GERENTE_PDC)).toEqual(["ase-pdc-tl1", "jr-pdc-tl1", "sr-pdc-tl2"])
    expect(asignablesPor({ id: "ger-tulum", role: "GERENTE", plaza: "TULUM" })).toEqual(["ase-tulum"])
  })

  it("GERENTE sin plaza: a nadie más (no amplía a ciegas)", () => {
    expect(asignablesPor(GERENTE_SIN_PLAZA)).toEqual([])
  })

  it("TEAM_LEADER: solo los asesores de su equipo", () => {
    expect(asignablesPor(TL1)).toEqual(["ase-pdc-tl1", "jr-pdc-tl1"])
  })

  it("ASESOR, BROKER, HOSTESS, MARKETING: a nadie más", () => {
    for (const role of ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "HOSTESS", "MARKETING", "MANTENIMIENTO"]) {
      expect(asignablesPor({ ...ASESOR, role })).toEqual([])
    }
  })

  it("nunca a una cuenta inactiva, borrada o técnica, ni a un rol que no es asesor", () => {
    for (const id of ["ase-baja", "ase-borrado", "ase-local", "tl-2", "ger-tulum", "hostess", "broker"]) {
      const destino = USUARIOS.find((u) => u.id === id)!
      expect(puedeAsignarTareaA(ADMIN, destino)).toBe(false)
    }
  })

  it("a uno mismo siempre se puede, sea cual sea el rol", () => {
    for (const actor of [ADMIN, GERENTE_PDC, TL1, ASESOR, { id: "h", role: "HOSTESS" }]) {
      expect(puedeAsignarTareaA(actor, { id: actor.id, role: actor.role, isActive: true })).toBe(true)
    }
  })

  it("niveles", () => {
    expect(nivelAsignacion(ADMIN)).toBe("TODOS")
    expect(nivelAsignacion(GERENTE_PDC)).toBe("PLAZA")
    expect(nivelAsignacion(GERENTE_SIN_PLAZA)).toBe("SOLO_YO")
    expect(nivelAsignacion(TL1)).toBe("EQUIPO")
    expect(nivelAsignacion(ASESOR)).toBe("SOLO_YO")
  })
})

// Evaluador mínimo del `where` que arma asignablesWhere, para comprobar que la lista del selector
// y la validación del servidor dicen lo mismo (dos copias de una regla que divergen es el defecto
// que más se ha repetido en este CRM).
function cumple(u: DestinoAsignacion, w: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(w)) {
    if (k === "NOT") {
      const not = v as { email: { endsWith: string } }
      if ((u.email ?? "").endsWith(not.email.endsWith)) return false
      continue
    }
    const actual = (u as unknown as Record<string, unknown>)[k] ?? null
    if (v && typeof v === "object" && "in" in (v as object)) {
      if (!(v as { in: unknown[] }).in.includes(actual)) return false
    } else if (v && typeof v === "object" && "not" in (v as object)) {
      if (actual === (v as { not: unknown }).not) return false
    } else if (actual !== v) {
      return false
    }
  }
  return true
}

describe("asignablesWhere coincide con puedeAsignarTareaA", () => {
  for (const actor of [ADMIN, DIRECTOR, GERENTE_PDC, GERENTE_SIN_PLAZA, TL1, ASESOR]) {
    it(`${actor.role}${actor.plaza ? ` (${actor.plaza})` : ""}`, () => {
      const where = asignablesWhere(actor)
      const porWhere = where
        ? USUARIOS.filter((u) => cumple({ deletedAt: null, ...u }, where as Record<string, unknown>))
            .map((u) => u.id)
            .sort()
        : []
      expect(porWhere).toEqual(asignablesPor(actor))
    })
  }
})
