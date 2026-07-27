import { describe, it, expect } from "vitest"
import { UserRole } from "@prisma/client"
import { resolveActivityScope, type ActivityScope } from "./scope"

describe("resolveActivityScope", () => {
  // El bug: ADMIN está en FULL_ACCESS_ROLES y en TEAM_ACCESS_ROLES a la vez.
  // Con la cadena OWN→TEAM→FULL caía en TEAM y el admin solo veía a su equipo
  // en getActivities, getOverdueTasks y el dashboard. Este es EL test.
  it("ADMIN ve TODO aunque también pertenezca al set TEAM", () => {
    expect(resolveActivityScope("ADMIN")).toBe("ALL")
  })

  it.each(["DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"])(
    "%s ve todo (acceso total)",
    (role) => {
      expect(resolveActivityScope(role)).toBe("ALL")
    },
  )

  it("MARKETING ve todo (no está en ningún set, se resuelve explícito)", () => {
    expect(resolveActivityScope("MARKETING")).toBe("ALL")
  })

  it("TEAM_LEADER ve a su equipo", () => {
    expect(resolveActivityScope("TEAM_LEADER")).toBe("TEAM")
  })

  it.each(["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "HOSTESS"])(
    "%s ve solo lo propio",
    (role) => {
      expect(resolveActivityScope(role)).toBe("OWN")
    },
  )

  it("un rol desconocido queda DENIED, no cae a un default permisivo", () => {
    expect(resolveActivityScope("ROL_QUE_NO_EXISTE")).toBe("DENIED")
  })

  // Anti-clase: no fija los roles de hoy, fija la REGLA. Si alguien agrega un
  // valor al enum UserRole y no lo mete en ningún set, este test falla y le
  // obliga a decidir su alcance en vez de heredar el default silenciosamente.
  it("todo rol del enum UserRole tiene un alcance asignado (ninguno cae en DENIED)", () => {
    const sinAlcance = Object.values(UserRole).filter(
      (role) => resolveActivityScope(role) === "DENIED",
    )
    expect(sinAlcance).toEqual([])
  })

  it("cada rol del enum resuelve a un alcance válido y estable", () => {
    const validos: ActivityScope[] = ["ALL", "TEAM", "OWN", "DENIED"]
    for (const role of Object.values(UserRole)) {
      expect(validos).toContain(resolveActivityScope(role))
    }
  })
})
