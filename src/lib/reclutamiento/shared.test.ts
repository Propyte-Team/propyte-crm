import { describe, it, expect } from "vitest";
import {
  ETAPAS,
  candidatoCrearSchema,
  candidatoEditarSchema,
  celda,
  filtrarCandidatos,
  rutaCvCandidato,
  rutaEsDelCandidato,
  ubicacionLabel,
  UBICACIONES,
  type CandidatoFila,
} from "./shared";
import { RECLUTAMIENTO_ROLES, puedeEliminarEnReclutamiento, puedeVerReclutamiento } from "./roles";

// #926 — Reglas de Reclutamiento: lo que pidió sistemas@ (campos, etapas, «-» en lo vacío) y
// las puertas de acceso a datos personales.

describe("etapas", () => {
  it("son las diez de la base de Notion, en su orden", () => {
    expect(ETAPAS.map((e) => e.label)).toEqual([
      "1 · Recibido",
      "2 · Filtro CV",
      "3 · Contacto inicial",
      "4 · Entrevista Luis",
      "5 · Prueba técnica",
      "6 · Entrevista Dirección/RH",
      "7 · Oferta",
      "8 · Contratado",
      "X · Descartado",
      "P · Banco de talento",
    ]);
    expect(new Set(ETAPAS.map((e) => e.code)).size).toBe(ETAPAS.length);
  });
});

describe("validación del alta", () => {
  it("solo el nombre es obligatorio; lo vacío se guarda como null", () => {
    const r = candidatoCrearSchema.safeParse({
      fullName: "  Ana López  ",
      age: "",
      email: " ",
      phone: "",
      area: "",
      plaza: "",
      portfolioUrl: "",
      notes: "",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({ fullName: "Ana López", age: null, email: null, phone: null, area: null, plaza: null, portfolioUrl: null, notes: null });
    expect(candidatoCrearSchema.safeParse({ fullName: "  " }).success).toBe(false);
  });

  it("edad: número entero entre 14 y 99 (el formulario la manda como texto)", () => {
    expect(candidatoCrearSchema.parse({ fullName: "A", age: "27" }).age).toBe(27);
    expect(candidatoCrearSchema.safeParse({ fullName: "A", age: "8" }).success).toBe(false);
    expect(candidatoCrearSchema.safeParse({ fullName: "A", age: "27.5" }).success).toBe(false);
    expect(candidatoCrearSchema.safeParse({ fullName: "A", age: "veinte" }).success).toBe(false);
  });

  it("correo, ubicación, etapa y portafolio se validan", () => {
    expect(candidatoCrearSchema.safeParse({ fullName: "A", email: "no-es-correo" }).success).toBe(false);
    expect(candidatoCrearSchema.safeParse({ fullName: "A", plaza: "CHETUMAL" }).success).toBe(false);
    expect(candidatoCrearSchema.safeParse({ fullName: "A", stage: "INVENTADA" }).success).toBe(false);
    expect(candidatoCrearSchema.safeParse({ fullName: "A", portfolioUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(candidatoCrearSchema.parse({ fullName: "A", plaza: "TULUM", stage: "OFERTA", portfolioUrl: "behance.net/ana" })).toMatchObject({
      plaza: "TULUM",
      stage: "OFERTA",
      portfolioUrl: "behance.net/ana",
    });
  });

  it("no acepta campos fuera de la lista (p. ej. deletedAt)", () => {
    expect(candidatoCrearSchema.safeParse({ fullName: "A", deletedAt: null }).success).toBe(false);
    expect(candidatoEditarSchema.safeParse({ source: "CHAT" }).success).toBe(false);
  });

  it("la edición acepta solo la etapa, y rechaza un cuerpo vacío", () => {
    expect(candidatoEditarSchema.parse({ stage: "CONTRATADO" })).toEqual({ stage: "CONTRATADO" });
    expect(candidatoEditarSchema.safeParse({}).success).toBe(false);
  });
});

describe("celdas", () => {
  it("vacío, null o espacios → «-»", () => {
    expect(celda(null)).toBe("-");
    expect(celda("   ")).toBe("-");
    expect(celda("Sistemas")).toBe("Sistemas");
    expect(ubicacionLabel("PDC")).toBe("Playa del Carmen");
    expect(ubicacionLabel(null)).toBeNull();
  });

  it("#927: ubicación = las seis opciones de Notion, en su orden (lugar de trabajo o modalidad)", () => {
    expect(UBICACIONES.map((u) => u.label)).toEqual(["Playa del Carmen", "Mérida", "Tulum", "Cancún", "Remoto", "Foráneo"]);
    for (const u of UBICACIONES) expect(candidatoCrearSchema.parse({ fullName: "A", plaza: u.code }).plaza).toBe(u.code);
    expect(ubicacionLabel("REMOTO")).toBe("Remoto");
  });
});

describe("filtro de la tabla", () => {
  const base: CandidatoFila = {
    id: "1", fullName: "Montserrat Berenice", age: null, email: "monse@mail.com", phone: "984 111 2222", area: "Marketing",
    plaza: "TULUM", portfolioUrl: null, notes: null, stage: "CONTACTO_INICIAL", source: "MANUAL", createdAt: "", cvs: [],
  };
  const filas = [base, { ...base, id: "2", fullName: "Daniel Bolio", email: null, area: "Sistemas", plaza: "MERIDA", stage: "FILTRO_CV" }];

  it("por texto sin importar acentos ni mayúsculas, por etapa y por ubicación", () => {
    expect(filtrarCandidatos(filas, { texto: "BERENICE" }).map((f) => f.id)).toEqual(["1"]);
    expect(filtrarCandidatos(filas, { texto: "sistemas" }).map((f) => f.id)).toEqual(["2"]);
    expect(filtrarCandidatos(filas, { etapa: "FILTRO_CV" }).map((f) => f.id)).toEqual(["2"]);
    expect(filtrarCandidatos(filas, { ubicacion: "TULUM" }).map((f) => f.id)).toEqual(["1"]);
    expect(filtrarCandidatos(filas, {})).toHaveLength(2);
  });
});

describe("rutas del CV", () => {
  const C = "11111111-1111-4111-8111-111111111111";
  it("la ruta no lleva el nombre original y solo vale para su candidato", () => {
    const r = rutaCvCandidato(C, "CV Ana López.PDF");
    expect(r).toMatch(new RegExp(`^candidates/${C}/cv/[0-9a-f-]{36}\\.pdf$`));
    expect(r).not.toContain("Ana");
    expect(rutaEsDelCandidato(r, C)).toBe(true);
    expect(rutaEsDelCandidato(r, "22222222-2222-4222-8222-222222222222")).toBe(false);
    expect(rutaEsDelCandidato(`contacts/${C}/cv/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.pdf`, C)).toBe(false);
    expect(rutaEsDelCandidato(`candidates/${C}/cv/../../x.pdf`, C)).toBe(false);
  });
});

describe("roles (datos personales)", () => {
  it("solo ADMIN, DIRECTOR y GERENTE entran; borran ADMIN y DIRECTOR; fail-closed", () => {
    expect([...RECLUTAMIENTO_ROLES]).toEqual(["ADMIN", "DIRECTOR", "GERENTE"]);
    for (const r of ["ASESOR", "ASESOR_SR", "TEAM_LEADER", "MARKETING", "BROKER", "HOSTESS", "DEVELOPER_EXT", "", null, undefined]) {
      expect(puedeVerReclutamiento(r), String(r)).toBe(false);
    }
    expect(puedeEliminarEnReclutamiento("GERENTE")).toBe(false);
    expect(puedeEliminarEnReclutamiento("DIRECTOR")).toBe(true);
  });
});
