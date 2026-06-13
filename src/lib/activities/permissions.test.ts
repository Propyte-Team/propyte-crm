import { describe, it, expect } from "vitest"
import { canModifyActivity } from "./permissions"

describe("canModifyActivity", () => {
  it("ASESOR dueño puede modificar", () => {
    expect(canModifyActivity("ASESOR", true)).toBe(true)
  })
  it("ASESOR ajeno NO puede modificar", () => {
    expect(canModifyActivity("ASESOR", false)).toBe(false)
  })
  it("ASESOR_JR ajeno NO puede modificar", () => {
    expect(canModifyActivity("ASESOR_JR", false)).toBe(false)
  })
  it("ADMIN puede modificar aunque no sea dueño", () => {
    expect(canModifyActivity("ADMIN", false)).toBe(true)
  })
  it("GERENTE puede modificar aunque no sea dueño", () => {
    expect(canModifyActivity("GERENTE", false)).toBe(true)
  })
  it("TEAM_LEADER puede modificar aunque no sea dueño", () => {
    expect(canModifyActivity("TEAM_LEADER", false)).toBe(true)
  })
})
