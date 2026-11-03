import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CandidatoYaExiste,
  ESTADO_CONTACTO_RECLUTAMIENTO,
  elegirContacto,
  partirNombre,
  plazaDelCrm,
  telefonoLlave,
} from "./contacto";

// #959 — reglas del alta manual de Reclutamiento → Contactos. Son las mismas que el llenado de la
// migración; la última prueba amarra que no se separen.

describe("partirNombre", () => {
  it("4 palabras o más: las dos primeras son el nombre", () => {
    expect(partirNombre("Jesús Rafael Torres Lizama")).toEqual({ firstName: "Jesús Rafael", lastName: "Torres Lizama" });
    expect(partirNombre("Dany A. Torres Calvo")).toEqual({ firstName: "Dany A.", lastName: "Torres Calvo" });
    expect(partirNombre("María de la Luz Pérez")).toEqual({ firstName: "María de", lastName: "la Luz Pérez" });
  });
  it("menos de 4: solo la primera; espacios de más no cuentan", () => {
    expect(partirNombre("  Javier   Martínez Reyes ")).toEqual({ firstName: "Javier", lastName: "Martínez Reyes" });
    expect(partirNombre("Ramón Granados")).toEqual({ firstName: "Ramón", lastName: "Granados" });
    expect(partirNombre("Dalay")).toEqual({ firstName: "Dalay", lastName: "" });
  });
  it("nunca deja el nombre vacío", () => {
    expect(partirNombre("   ")).toEqual({ firstName: "Sin nombre", lastName: "" });
  });
});

describe("plazaDelCrm", () => {
  it("solo PDC, Tulum y Mérida son plazas del CRM", () => {
    expect(plazaDelCrm("PDC")).toBe("PDC");
    expect(plazaDelCrm("TULUM")).toBe("TULUM");
    expect(plazaDelCrm("MERIDA")).toBe("MERIDA");
    for (const u of ["CANCUN", "REMOTO", "FORANEO", "", null, undefined]) expect(plazaDelCrm(u), String(u)).toBeNull();
  });
});

describe("telefonoLlave", () => {
  it("los 10 últimos dígitos, sin importar el formato", () => {
    expect(telefonoLlave("+52 999 453 3580")).toBe("9994533580");
    expect(telefonoLlave("+5219994533580")).toBe("9994533580");
    expect(telefonoLlave("999-453-3580")).toBe("9994533580");
  });
  it("menos de 10 dígitos o vacío → null (no se cruza)", () => {
    expect(telefonoLlave("453 3580")).toBeNull();
    expect(telefonoLlave("")).toBeNull();
    expect(telefonoLlave(null)).toBeNull();
  });
});

describe("elegirContacto", () => {
  const k = (id: string, contactType: string | null, fecha: string) => ({ id, contactType, createdAt: new Date(fecha) });
  it("gana el que ya es Empleo; entre iguales, el más antiguo", () => {
    expect(elegirContacto([k("a", "LEAD_COMPRADOR", "2026-01-01"), k("b", "EMPLEO", "2026-03-01")])?.id).toBe("b");
    expect(elegirContacto([k("a", null, "2026-02-01"), k("b", null, "2026-01-01")])?.id).toBe("b");
    expect(elegirContacto([])).toBeNull();
  });
});

describe("CandidatoYaExiste", () => {
  it("dice con qué nombre está ya en Reclutamiento", () => {
    expect(new CandidatoYaExiste("Luis Loría").message).toBe("Esta persona ya está en Reclutamiento como «Luis Loría». Búscala en la tabla.");
  });
});

describe("paridad con la migración", () => {
  const sql = readFileSync(join(process.cwd(), "prisma/migrations-manual/2026-11-03-reclutamiento-contactos.sql"), "utf8");
  it("mismo estado, misma regla de nombre, mismas plazas y misma llave de teléfono", () => {
    expect(ESTADO_CONTACTO_RECLUTAMIENTO).toBe("DERIVADO_A_RH");
    expect(sql).toContain("'DERIVADO_A_RH'");
    expect(sql).toContain("WHEN cardinality(p.w) >= 4 THEN p.w[1] || ' ' || p.w[2]");
    expect(sql).toContain("r.plaza IN ('PDC', 'TULUM', 'MERIDA')");
    expect(sql).toContain("right(regexp_replace(coalesce(r.phone, ''), '\\D', '', 'g'), 10)");
  });
  it("el disparador cubre alta, cambio de tipo y fusión, y nunca duplica", () => {
    expect(sql).toContain('AFTER INSERT OR UPDATE OF "contactType", "mergedIntoId" ON propyte_crm.contacts');
    expect(sql).toContain('ON CONFLICT ("contactId") DO NOTHING');
    expect(sql).toContain("stage NOT IN ('DESCARTADO', 'CONTRATADO')");
    // Ida y vuelta: el descarte automático guarda la etapa y la devuelve al volver a Empleo.
    expect(sql).toContain('SET "stagePrevia" = stage,');
    expect(sql).toContain('SET stage = "stagePrevia",');
  });
});
