import { describe, it, expect } from "vitest";
import {
  celda,
  hrefSitio,
  puedeEditarDesarrolladores,
  desarrolladorCrearSchema,
  desarrolladorEditarSchema,
  TIPOS_EMPRESA,
  esTipoEmpresa,
  etiquetaTipoEmpresa,
  whereTipoEmpresa,
  filtrarEmpresas,
  ofrecerCrearEmpresa,
  campoEmpresa,
  hrefEmpresa,
} from "./shared";

// #872 — Desarrolladores; #949 — Empresas (tipo, GERENTE escribe, selector).

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
  it.each(["ADMIN", "DIRECTOR", "GERENTE"])("%s sí", (r) => expect(puedeEditarDesarrolladores(r)).toBe(true));
  it.each(["TEAM_LEADER", "ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "MARKETING", "HOSTESS", "DEVELOPER_EXT", "MANTENIMIENTO", "ROL_NUEVO", "", null, undefined])(
    "%s no",
    (r) => expect(puedeEditarDesarrolladores(r as string)).toBe(false),
  );
});

describe("validación del alta", () => {
  it("nombre y tipo son obligatorios; lo vacío se guarda como null", () => {
    const r = desarrolladorCrearSchema.parse({ name: " Onix Living ", type: "DESARROLLADORA", website: "", email: "  ", phone: "" });
    expect(r).toEqual({ name: "Onix Living", type: "DESARROLLADORA", website: null, email: null, phone: null });
  });
  it("sin nombre se rechaza", () => {
    expect(desarrolladorCrearSchema.safeParse({ name: "   ", type: "PROVEEDOR" }).success).toBe(false);
    expect(desarrolladorCrearSchema.safeParse({ type: "PROVEEDOR" }).success).toBe(false);
  });
  it("sin tipo, o con un tipo fuera de la lista, se rechaza con mensaje claro", () => {
    const sin = desarrolladorCrearSchema.safeParse({ name: "Onix" });
    expect(sin.success).toBe(false);
    expect(sin.error?.issues[0].message).toBe("Elige el tipo de empresa");
    expect(desarrolladorCrearSchema.safeParse({ name: "Onix", type: "NAVIERA" }).success).toBe(false);
    expect(desarrolladorCrearSchema.safeParse({ name: "Onix", type: "desarrolladora" }).success).toBe(false);
  });
  it("email inválido se rechaza", () => {
    expect(desarrolladorCrearSchema.safeParse({ name: "X", type: "PROVEEDOR", email: "no-es-email" }).success).toBe(false);
  });
  it("sitio con esquema peligroso se rechaza", () => {
    expect(desarrolladorCrearSchema.safeParse({ name: "X", type: "PROVEEDOR", website: "javascript:alert(1)" }).success).toBe(false);
  });
  it("campos desconocidos se rechazan", () => {
    expect(desarrolladorCrearSchema.safeParse({ name: "X", type: "PROVEEDOR", createdById: "otro" }).success).toBe(false);
  });
  it("datos completos pasan", () => {
    expect(
      desarrolladorCrearSchema.parse({ name: "Onix", type: "INMOBILIARIA", website: "onix.mx", email: "hola@onix.mx", phone: "+52 984 123 4567" }),
    ).toEqual({ name: "Onix", type: "INMOBILIARIA", website: "onix.mx", email: "hola@onix.mx", phone: "+52 984 123 4567" });
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
  it("cambia solo el tipo; un tipo fuera de la lista se rechaza", () => {
    expect(desarrolladorEditarSchema.parse({ type: "PROVEEDOR" })).toEqual({ type: "PROVEEDOR" });
    expect(desarrolladorEditarSchema.safeParse({ type: "NAVIERA" }).success).toBe(false);
  });
});

describe("tipo de empresa (#949)", () => {
  it("los tres tipos pedidos, en orden", () => {
    expect(TIPOS_EMPRESA.map((t) => t.label)).toEqual(["Desarrolladora", "Inmobiliaria", "Proveedor"]);
  });
  it("esTipoEmpresa", () => {
    expect(esTipoEmpresa("INMOBILIARIA")).toBe(true);
    expect(esTipoEmpresa("NAVIERA")).toBe(false);
    expect(esTipoEmpresa(null)).toBe(false);
  });
  it("etiqueta: conocido → texto; vacío → «Sin tipo»; desconocido se muestra tal cual", () => {
    expect(etiquetaTipoEmpresa("PROVEEDOR")).toBe("Proveedor");
    expect(etiquetaTipoEmpresa(null)).toBe("Sin tipo");
    expect(etiquetaTipoEmpresa("NAVIERA")).toBe("NAVIERA");
  });
  it("whereTipoEmpresa: tipo, «Sin tipo», y lo desconocido no filtra", () => {
    expect(whereTipoEmpresa("DESARROLLADORA")).toEqual({ type: "DESARROLLADORA" });
    expect(whereTipoEmpresa("SIN_TIPO")).toEqual({ type: null });
    expect(whereTipoEmpresa("NAVIERA")).toBeNull();
    expect(whereTipoEmpresa(null)).toBeNull();
  });
  it("la migración marca las existentes con un tipo de la lista", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("prisma/migrations-manual/2026-10-29-empresas-contactos.sql", "utf8");
    const m = sql.match(/SET "type" = '([A-Z_]+)'/);
    expect(m && esTipoEmpresa(m[1])).toBe(true);
  });
});

describe("selector de empresa (#949)", () => {
  const lista = [
    { id: "1", name: "Ekasa", type: "DESARROLLADORA" },
    { id: "2", name: "Ánfora Bienes Raíces", type: "INMOBILIARIA" },
  ];
  it("filtra por nombre sin importar mayúsculas ni acentos", () => {
    expect(filtrarEmpresas(lista, "anfora").map((e) => e.id)).toEqual(["2"]);
    expect(filtrarEmpresas(lista, "EKA").map((e) => e.id)).toEqual(["1"]);
    expect(filtrarEmpresas(lista, "  ")).toHaveLength(2);
  });
  it("ofrece crear solo a quien puede, con texto, y si no existe ya con ese nombre", () => {
    expect(ofrecerCrearEmpresa(lista, "Nueva Inmobiliaria", true)).toBe(true);
    expect(ofrecerCrearEmpresa(lista, "Nueva Inmobiliaria", false)).toBe(false);
    expect(ofrecerCrearEmpresa(lista, "  ", true)).toBe(false);
    expect(ofrecerCrearEmpresa(lista, "ekasa", true)).toBe(false);
    expect(ofrecerCrearEmpresa(lista, "anfora bienes raices", true)).toBe(false);
  });
  it("campoEmpresa: al crear solo si se eligió; al editar solo si cambió (incluido quitarla)", () => {
    expect(campoEmpresa("create", null, null)).toEqual({});
    expect(campoEmpresa("create", null, "1")).toEqual({ developerPartnerId: "1" });
    expect(campoEmpresa("edit", "1", "1")).toEqual({});
    expect(campoEmpresa("edit", "1", "2")).toEqual({ developerPartnerId: "2" });
    expect(campoEmpresa("edit", "1", null)).toEqual({ developerPartnerId: null });
    expect(campoEmpresa("edit", null, null)).toEqual({});
  });
  it("hrefEmpresa abre el cuadro de esa empresa", () => {
    expect(hrefEmpresa("a b")).toBe("/empresas?empresa=a%20b");
  });
});
