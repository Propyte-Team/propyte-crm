import { describe, it, expect } from "vitest";
import {
  celda,
  hrefSitio,
  puedeEditarDesarrolladores,
  desarrolladorCrearSchema,
  desarrolladorEditarSchema,
} from "./shared";

// #872 — Desarrolladores.

describe("celda: lo vacío se muestra como «-»", () => {
  it.each([null, undefined, "", "   "])("%j → -", (v) => {
    expect(celda(v)).toBe("-");
  });
  it("un dato se muestra tal cual (recortado)", () => {
    expect(celda("  Nativa  ")).toBe("Nativa");
  });
});

describe("hrefSitio", () => {
  it("antepone https:// a lo capturado sin esquema", () => {
    expect(hrefSitio("nativa.mx")).toBe("https://nativa.mx/");
    expect(hrefSitio("www.nativa.mx/proyectos")).toBe("https://www.nativa.mx/proyectos");
  });
  it("respeta http(s) ya escrito", () => {
    expect(hrefSitio("http://nativa.mx")).toBe("http://nativa.mx/");
  });
  it.each(["javascript:alert(1)", "data:text/html,hola", "mailto:a@b.com"])("no vuelve enlace %s", (v) => {
    expect(hrefSitio(v)).toBeNull();
  });
  it("vacío → sin enlace", () => {
    expect(hrefSitio("")).toBeNull();
    expect(hrefSitio(null)).toBeNull();
  });
});

describe("quién edita", () => {
  it.each(["ADMIN", "DIRECTOR"])("%s sí", (r) => expect(puedeEditarDesarrolladores(r)).toBe(true));
  it.each(["GERENTE", "TEAM_LEADER", "ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "MARKETING", "HOSTESS", "DEVELOPER_EXT", "MANTENIMIENTO", "ROL_NUEVO", "", null, undefined])(
    "%s no",
    (r) => expect(puedeEditarDesarrolladores(r as string)).toBe(false),
  );
});

describe("validación del alta", () => {
  it("solo el nombre es obligatorio; lo vacío se guarda como null", () => {
    const r = desarrolladorCrearSchema.parse({ name: " Onix Living ", website: "", email: "  ", phone: "" });
    expect(r).toEqual({ name: "Onix Living", website: null, email: null, phone: null });
  });
  it("sin nombre se rechaza", () => {
    expect(desarrolladorCrearSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(desarrolladorCrearSchema.safeParse({}).success).toBe(false);
  });
  it("email inválido se rechaza", () => {
    expect(desarrolladorCrearSchema.safeParse({ name: "X", email: "no-es-email" }).success).toBe(false);
  });
  it("sitio con esquema peligroso se rechaza", () => {
    expect(desarrolladorCrearSchema.safeParse({ name: "X", website: "javascript:alert(1)" }).success).toBe(false);
  });
  it("campos desconocidos se rechazan", () => {
    expect(desarrolladorCrearSchema.safeParse({ name: "X", createdById: "otro" }).success).toBe(false);
  });
  it("datos completos pasan", () => {
    expect(
      desarrolladorCrearSchema.parse({ name: "Onix", website: "onix.mx", email: "hola@onix.mx", phone: "+52 984 123 4567" }),
    ).toEqual({ name: "Onix", website: "onix.mx", email: "hola@onix.mx", phone: "+52 984 123 4567" });
  });
});

describe("validación de la edición", () => {
  it("vaciar un campo lo deja en null (y la celda mostrará «-»)", () => {
    expect(desarrolladorEditarSchema.parse({ phone: "" })).toEqual({ phone: null });
  });
  it("no deja borrar el nombre", () => {
    expect(desarrolladorEditarSchema.safeParse({ name: "" }).success).toBe(false);
  });
  it("cuerpo vacío se rechaza", () => {
    expect(desarrolladorEditarSchema.safeParse({}).success).toBe(false);
  });
});
