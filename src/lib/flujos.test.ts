import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FLUJO_ORDER,
  FLUJO_LABELS,
  FLUJO_VACIO_LABEL,
  etiquetaFlujo,
  opcionesFlujo,
  FLUJO_SIN_FLUJO,
  whereFlujo,
  campoFlujo,
} from "./flujos";
import { COLUMNAS_CONTACTOS } from "@/lib/contacts/columnas";
import { CORE_FIELDS } from "@/lib/metadata/core-fields-catalogo";
import { fieldChangeTitle } from "@/lib/timeline/format";
import { CAMPOS_EXPORTACION } from "@/lib/contacts/exportar";

// #948. La lista vive en un solo lugar (flujos.ts) y tiene que decir lo mismo que el enum de
// Prisma y que la migración que crea el tipo en Postgres: si uno de los tres se mueve solo, un
// valor válido en la base se rechaza en silencio o al revés (la familia de #730).
const raiz = join(__dirname, "..", "..");

function valoresDelEnumPrisma(nombre: string): string[] {
  const schema = readFileSync(join(raiz, "prisma", "schema.prisma"), "utf8");
  const m = schema.match(new RegExp(`enum ${nombre} \\{([\\s\\S]*?)\\}`));
  if (!m) throw new Error(`enum ${nombre} no está en schema.prisma`);
  return m[1]
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => l && !l.startsWith("@@"));
}

const migracion = readFileSync(join(raiz, "prisma", "migrations-manual", "2026-10-29-flujo.sql"), "utf8");

describe("Flujos F1–F8 (#948)", () => {
  it("son los 8 flujos del flujograma, en orden y sin repetidos", () => {
    expect(FLUJO_ORDER).toHaveLength(8);
    expect(new Set(FLUJO_ORDER).size).toBe(8);
    expect(FLUJO_ORDER.map((f) => f.slice(0, 2))).toEqual(["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"]);
  });

  it("coinciden con el enum Flujo de schema.prisma", () => {
    expect(valoresDelEnumPrisma("Flujo")).toEqual([...FLUJO_ORDER]);
  });

  it("coinciden con el CREATE TYPE de la migración", () => {
    const m = migracion.match(/CREATE TYPE propyte_crm\."Flujo" AS ENUM \(([\s\S]*?)\);/);
    expect(m, "la migración no crea el enum").toBeTruthy();
    const valores = [...m![1].matchAll(/'([A-Z0-9_]+)'/g)].map((x) => x[1]);
    expect(valores).toEqual([...FLUJO_ORDER]);
  });

  it("cada flujo tiene su etiqueta con el número del flujograma", () => {
    for (const f of FLUJO_ORDER) {
      expect(FLUJO_LABELS[f].startsWith(`${f.slice(0, 2)} · `), f).toBe(true);
    }
    expect(Object.keys(FLUJO_LABELS)).toEqual([...FLUJO_ORDER]);
  });

  it("vacío se muestra como «Sin flujo», nunca en blanco", () => {
    expect(etiquetaFlujo(null)).toBe(FLUJO_VACIO_LABEL);
    expect(etiquetaFlujo(undefined)).toBe("Sin flujo");
    expect(etiquetaFlujo("")).toBe("Sin flujo");
    expect(etiquetaFlujo("F5_NATIVA")).toBe("F5 · Nativa");
  });

  it("las opciones del selector empiezan por «Sin flujo» y luego los 8", () => {
    const o = opcionesFlujo();
    expect(o).toHaveLength(9);
    expect(o[0]).toEqual({ value: "", label: "Sin flujo" });
    expect(o.slice(1).map((x) => x.value)).toEqual([...FLUJO_ORDER]);
  });
});

describe("El flujo en la ficha, la cronología y la exportación (#948)", () => {
  it("es un campo del contacto gateable por rol, en Clasificación", () => {
    const campo = CORE_FIELDS.contact.find((c) => c.key === "flujo");
    expect(campo).toEqual({ key: "flujo", label: "Flujo", group: "Clasificación" });
  });

  it("la cronología lo lee con etiquetas, no con el valor técnico", () => {
    expect(fieldChangeTitle("flujo", null, "F6_BROKER")).toBe("Flujo se actualizó de — a F6 · Broker");
    expect(fieldChangeTitle("flujo", "F1_CORRETAJE_VENDEDOR", "F2_CORRETAJE_COMPRADOR")).toBe(
      "Flujo se actualizó de F1 · Corretaje vendedor a F2 · Corretaje comprador",
    );
  });

  it("se puede exportar y vacío sale «Sin flujo»", () => {
    const campo = CAMPOS_EXPORTACION.find((c) => c.key === "flujo");
    expect(campo?.label).toBe("Flujo");
    expect(campo?.valor({ flujo: null } as never)).toBe("Sin flujo");
    expect(campo?.valor({ flujo: "F8_EMPLEO" } as never)).toBe("F8 · Empleo");
  });
});

describe("Llenado automático en la base (#948, decisión de sistemas@ 2026-10-29)", () => {
  // La regla vive SOLO en los disparadores de la migración (contactos y negocios se escriben por
  // muchos caminos). Esto fija que la migración diga lo que se decidió; el comportamiento contra un
  // Postgres real se probó al preparar la entrega (ver COMO-APLICAR-948).
  it("contacto Broker externo → F6 y Empleo → F8, solo si está vacío", () => {
    expect(migracion).toMatch(/BEFORE INSERT OR UPDATE OF "contactType" ON propyte_crm\.contacts/);
    expect(migracion).toMatch(/WHEN 'BROKER_EXTERNO' THEN 'F6_BROKER'/);
    expect(migracion).toMatch(/WHEN 'EMPLEO'\s+THEN 'F8_EMPLEO'/);
  });

  it("negocio Nativa → F5; si no, el flujo del contacto al crearse", () => {
    expect(migracion).toMatch(/BEFORE INSERT OR UPDATE OF "dealType" ON propyte_crm\.deals/);
    expect(migracion).toMatch(/IN \('NATIVA_CONTADO', 'NATIVA_FINANCIAMIENTO'\) THEN\s+NEW\.flujo := 'F5_NATIVA'/);
    expect(migracion).toMatch(/TG_OP = 'INSERT' THEN\s+SELECT c\.flujo INTO NEW\.flujo FROM propyte_crm\.contacts c/);
  });

  it("Corretaje y Masterbroker NO se llenan solos", () => {
    expect(migracion).not.toMatch(/'F1_CORRETAJE_VENDEDOR'::|SET flujo = 'F[1-4]_/);
  });
});

describe("Lista de Contactos y formulario (#951)", () => {
  it("el filtro «Sin flujo» busca NULL; un flujo, ese valor; lo demás no filtra", () => {
    expect(whereFlujo("SIN_FLUJO")).toEqual({ flujo: null });
    expect(whereFlujo(FLUJO_SIN_FLUJO)).toEqual({ flujo: null });
    expect(whereFlujo("F7_INMOBILIARIA")).toEqual({ flujo: "F7_INMOBILIARIA" });
    expect(whereFlujo(null)).toBeNull();
    expect(whereFlujo("")).toBeNull();
    expect(whereFlujo("ALL")).toBeNull();
    expect(whereFlujo("f6_broker")).toBeNull();
  });

  it("la tabla de Contactos ofrece la columna «Flujo», visible por defecto, junto al tipo", () => {
    const i = COLUMNAS_CONTACTOS.findIndex((c) => c.key === "flujo");
    expect(COLUMNAS_CONTACTOS[i]).toMatchObject({ label: "Flujo", defaultVisible: true });
    expect(COLUMNAS_CONTACTOS[i - 1].key).toBe("tipo");
  });

  it("al crear, el formulario manda el flujo solo si se eligió", () => {
    expect(campoFlujo("create", null, "F2_CORRETAJE_COMPRADOR")).toEqual({ flujo: "F2_CORRETAJE_COMPRADOR" });
    expect(campoFlujo("create", null, null)).toEqual({});
  });

  it("al editar, solo si cambió (un rol con el flujo en solo lectura puede guardar lo demás)", () => {
    expect(campoFlujo("edit", "F6_BROKER", "F6_BROKER")).toEqual({});
    expect(campoFlujo("edit", null, null)).toEqual({});
    expect(campoFlujo("edit", undefined, null)).toEqual({});
    expect(campoFlujo("edit", "F6_BROKER", "F1_CORRETAJE_VENDEDOR")).toEqual({ flujo: "F1_CORRETAJE_VENDEDOR" });
    expect(campoFlujo("edit", "F6_BROKER", null)).toEqual({ flujo: null });
  });
});
