import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// #914 — «Información adicional» del contacto. La lista única tiene que coincidir con la base
// (schema.prisma y la migración manual), con el catálogo de permisos y con el historial.

vi.mock("@/lib/db", () => ({ default: {} }));

import {
  CAMPOS_ADICIONALES,
  CAMPOS_ADICIONALES_SHAPE,
  CLAVES_CAMPOS_ADICIONALES,
  datosCamposAdicionales,
} from "./campos-adicionales";
import { coreFieldKeys, nonEditableKeys, stripHiddenCoreFields } from "@/lib/metadata/core-fields";
import { fieldLabel } from "@/lib/timeline/format";

const raiz = join(__dirname, "..", "..", "..");

function modelo(nombre: string): string {
  const schema = readFileSync(join(raiz, "prisma", "schema.prisma"), "utf8");
  const ini = schema.indexOf(`model ${nombre} {`);
  expect(ini).toBeGreaterThan(-1);
  return schema.slice(ini, schema.indexOf("\n}", ini));
}

describe("lista única vs. base de datos", () => {
  const contact = modelo("Contact");
  const sql = readFileSync(
    join(raiz, "prisma", "migrations-manual", "2026-10-20-columnas-migracion-zoho.sql"),
    "utf8",
  );

  it.each(CAMPOS_ADICIONALES.map((c) => [c.key, c.tipo] as const))(
    "%s está declarado en model Contact con el tipo correcto y es nullable",
    (key, tipo) => {
      const linea = contact.split("\n").find((l) => new RegExp(`^\\s*${key}\\s`).test(l));
      expect(linea, `falta ${key} en model Contact`).toBeDefined();
      expect(linea).toMatch(tipo === "booleano" ? /\sBoolean\?/ : /\sString\?/);
    },
  );

  it.each(CLAVES_CAMPOS_ADICIONALES.map((k) => [k]))("%s se agrega en la migración manual", (key) => {
    expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS "${key}"\\s`));
  });

  it("los cinco campos del anuncio están en model AdAttribution y en la migración", () => {
    const ad = modelo("AdAttribution");
    for (const key of ["metaCampaignId", "metaAdsetId", "metaAdId", "metaFormId", "formName"]) {
      expect(ad).toMatch(new RegExp(`\\n\\s*${key}\\s+String\\?`));
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS "${key}"\\s`));
    }
  });

  it("la migración solo agrega (nada de DROP/ALTER COLUMN/NOT NULL fuera de comentarios)", () => {
    const codigo = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(codigo).not.toMatch(/\bDROP\b|ALTER COLUMN|NOT NULL|DEFAULT/i);
  });
});

describe("validación (lo que acepta /api/contacts)", () => {
  const esquema = z.object(CAMPOS_ADICIONALES_SHAPE).partial();

  it("acepta texto, null y vacío; respeta el largo máximo", () => {
    expect(esquema.safeParse({ company: "Duke del Caribe", facebook: null, budgetText: "" }).success).toBe(true);
    expect(esquema.safeParse({ company: "x".repeat(201) }).success).toBe(false);
    expect(esquema.safeParse({ initialMessage: "x".repeat(5000) }).success).toBe(true);
    expect(esquema.safeParse({ initialMessage: "x".repeat(5001) }).success).toBe(false);
  });

  it("Email 2: rechaza basura, acepta vacío (= borrar) y lo normaliza", () => {
    expect(esquema.safeParse({ secondaryEmail: "no-es-correo" }).success).toBe(false);
    expect(esquema.safeParse({ secondaryEmail: "" }).success).toBe(true);
    const ok = esquema.safeParse({ secondaryEmail: "  Ana@Ejemplo.COM " });
    expect(ok.success && ok.data.secondaryEmail).toBe("ana@ejemplo.com");
  });

  it("En secuencia: solo booleano o null", () => {
    expect(esquema.safeParse({ inSequence: true }).success).toBe(true);
    expect(esquema.safeParse({ inSequence: null }).success).toBe(true);
    expect(esquema.safeParse({ inSequence: "sí" }).success).toBe(false);
  });
});

describe("datosCamposAdicionales (lo que se escribe)", () => {
  it("solo las claves que vinieron; vacío y espacios → null; recorta", () => {
    expect(datosCamposAdicionales({ company: "  The Agency ", facebook: "", firstName: "Ana" })).toEqual({
      company: "The Agency",
      facebook: null,
    });
  });
  it("null borra; false se guarda como false (no es «sin dato»)", () => {
    expect(datosCamposAdicionales({ discardReason: null, inSequence: false })).toEqual({
      discardReason: null,
      inSequence: false,
    });
  });
  it("sin ninguna clave adicional no toca nada", () => {
    expect(datosCamposAdicionales({ firstName: "Ana", phone: "+52" })).toEqual({});
  });
});

describe("permisos por rol y historial", () => {
  it("todos están en el catálogo de campos core del contacto", () => {
    const claves = coreFieldKeys("contact");
    for (const k of CLAVES_CAMPOS_ADICIONALES) expect(claves.has(k)).toBe(true);
  });

  it("READ/HIDDEN los bloquean al editar y HIDDEN los quita del registro", () => {
    const bloqueadas = nonEditableKeys("contact", { company: "READ", initialMessage: "HIDDEN" });
    expect(bloqueadas.has("company")).toBe(true);
    expect(bloqueadas.has("initialMessage")).toBe(true);
    const visto = stripHiddenCoreFields("contact", { initialMessage: "HIDDEN" }, {
      id: "c1",
      company: "Duke",
      initialMessage: "Hola",
    });
    expect(visto).toEqual({ id: "c1", company: "Duke" });
  });

  it("el historial los nombra en español, no con el nombre de la columna", () => {
    expect(fieldLabel("company")).toBe("Empresa / inmobiliaria");
    expect(fieldLabel("initialMessage")).toBe("Mensaje inicial");
    expect(fieldLabel("inSequence")).toBe("En secuencia (Zoho)");
  });
});
