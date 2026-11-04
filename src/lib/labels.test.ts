// Tests del diccionario de etiquetas: cada diccionario cubre TODOS los valores del enum
// de Prisma (se lee prisma/schema.prisma para que el test falle si el schema crece).
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"
import {
  ROLE_LABELS_COMPLETO,
  TEAM_ROLE_LABELS,
  TERRITORY_TYPE_LABELS,
  ROUTING_STRATEGY_LABELS,
  AUTONOMY_LABELS,
  FIELD_TYPE_LABELS,
  PREFERRED_LANGUAGE_LABELS,
  PROPERTY_TYPE_LABELS,
  etiqueta,
  opciones,
} from "./labels"

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8")

function valoresDelEnum(nombre: string): string[] {
  const m = schema.match(new RegExp(`^enum ${nombre} \\{([\\s\\S]*?)^\\}`, "m"))
  if (!m) throw new Error(`enum ${nombre} no encontrado`)
  return m[1]
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => l && !l.startsWith("@@"))
    .map((l) => l.split(/\s+/)[0])
}

const casos: [string, Record<string, string>][] = [
  ["UserRole", ROLE_LABELS_COMPLETO],
  ["TeamRole", TEAM_ROLE_LABELS],
  ["TerritoryType", TERRITORY_TYPE_LABELS],
  ["LeadAssignmentMode", ROUTING_STRATEGY_LABELS],
  ["AutonomyLevel", AUTONOMY_LABELS],
  ["FieldType", FIELD_TYPE_LABELS],
  ["PreferredLanguage", PREFERRED_LANGUAGE_LABELS],
  ["PropertyType", PROPERTY_TYPE_LABELS],
]

describe("labels: cobertura de enums de Prisma", () => {
  it.each(casos)("%s está completo", (enumName, dict) => {
    const valores = valoresDelEnum(enumName)
    expect(valores.length).toBeGreaterThan(0)
    for (const v of valores) expect(dict[v], `${enumName}.${v}`).toBeTruthy()
  })

  it("ROLE_LABELS_COMPLETO traduce los roles nuevos", () => {
    expect(ROLE_LABELS_COMPLETO.ADMIN).toBe("Administrador")
    expect(ROLE_LABELS_COMPLETO.DIRECTOR).toBe("Director")
  })
})

describe("etiqueta", () => {
  it("devuelve la etiqueta conocida", () => {
    expect(etiqueta(TEAM_ROLE_LABELS, "LEADER")).toBe("Líder")
  })
  it("humaniza valores desconocidos", () => {
    expect(etiqueta(TEAM_ROLE_LABELS, "NEW_THING")).toBe("New thing")
    expect(etiqueta(TEAM_ROLE_LABELS, "snake_case")).toBe("Snake case")
  })
  it("usa fallback con vacío y no confunde el prototipo", () => {
    expect(etiqueta(TEAM_ROLE_LABELS, null)).toBe("—")
    expect(etiqueta(TEAM_ROLE_LABELS, undefined, "Sin rol")).toBe("Sin rol")
    expect(etiqueta(TEAM_ROLE_LABELS, "constructor")).toBe("Constructor")
  })
})

describe("opciones", () => {
  it("ordena por label", () => {
    const o = opciones(ROUTING_STRATEGY_LABELS)
    const labels = o.map((x) => x.label)
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "es")))
    expect(o).toContainEqual({ value: "MANUAL", label: "Manual" })
  })
})
