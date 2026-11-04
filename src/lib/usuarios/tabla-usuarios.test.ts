import { describe, expect, it } from "vitest";
import { AYUDA_ROL, ayudaDeRol, coincideBusqueda, filtrarUsuarios, rolUsaNivelCarrera } from "./tabla-usuarios";
import { ROLE_LABELS_COMPLETO } from "@/lib/labels";

const usuarios = [
  { name: "Ana Pérez", email: "ana@propyte.com", role: "ASESOR_SR", plaza: "TULUM" },
  { name: "Luis Gómez", email: "luis@propyte.com", role: "GERENTE", plaza: "TULUM" },
  { name: "María Núñez", email: "maria@otro.com", role: "ASESOR_JR", plaza: "CANCUN" },
];

describe("filtrarUsuarios", () => {
  it("sin filtros devuelve todos", () => {
    expect(filtrarUsuarios(usuarios, {})).toHaveLength(3);
  });
  it("busca por nombre ignorando acentos y mayúsculas", () => {
    expect(filtrarUsuarios(usuarios, { busqueda: "PEREZ" }).map((u) => u.name)).toEqual(["Ana Pérez"]);
    expect(filtrarUsuarios(usuarios, { busqueda: "nunez" }).map((u) => u.name)).toEqual(["María Núñez"]);
  });
  it("busca por correo", () => {
    expect(filtrarUsuarios(usuarios, { busqueda: "@otro" })).toHaveLength(1);
  });
  it("combina búsqueda con rol y plaza", () => {
    expect(filtrarUsuarios(usuarios, { busqueda: "propyte", plaza: "TULUM", rol: "GERENTE" })).toHaveLength(1);
    expect(filtrarUsuarios(usuarios, { busqueda: "propyte", plaza: "CANCUN" })).toHaveLength(0);
  });
  it("espacios solos no filtran", () => {
    expect(coincideBusqueda(usuarios[0], "   ")).toBe(true);
  });
});

describe("rolUsaNivelCarrera", () => {
  it("solo los roles de asesor", () => {
    for (const r of ["ASESOR", "ASESOR_SR", "ASESOR_JR"]) expect(rolUsaNivelCarrera(r)).toBe(true);
    for (const r of ["ADMIN", "GERENTE", "TEAM_LEADER", "HOSTESS", "BROKER", ""]) {
      expect(rolUsaNivelCarrera(r)).toBe(false);
    }
  });
});

describe("ayuda por rol", () => {
  it("todo rol del catálogo tiene ayuda sin claves técnicas", () => {
    for (const rol of Object.keys(ROLE_LABELS_COMPLETO)) {
      const t = ayudaDeRol(rol);
      expect(t, rol).toBeTruthy();
      expect(t).not.toMatch(/[A-Z]+_[A-Z]+/);
    }
    expect(Object.keys(AYUDA_ROL).length).toBeGreaterThanOrEqual(Object.keys(ROLE_LABELS_COMPLETO).length);
  });
  it("rol desconocido: sin ayuda", () => {
    expect(ayudaDeRol("XYZ")).toBeUndefined();
  });
});
