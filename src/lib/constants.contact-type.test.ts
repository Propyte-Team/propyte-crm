import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTACT_TYPE_ORDER,
  CONTACT_TYPE_LABELS,
  CONTACT_TYPE_RETIRADOS,
  normalizarTipoContacto,
} from "./constants";

// Tarjeta #730, la mitad de ContactType. Hermana de constants.lead-source.test.ts y por
// el mismo motivo: los z.enum escritos a mano se desincronizan del enum de Prisma sin que
// nada avise. Única fuente de verdad = CONTACT_TYPE_ORDER.
//
// La paridad estricta contra el enum de Prisma se comprueba abajo con `$Enums`, que
// necesita el cliente generado. Las dos primeras pruebas NO lo necesitan, así que corren
// también en entornos donde ese cliente no se puede descargar — y son las que fijan lo que
// de verdad se rompió: que COMPRADOR y los otros dos estuvieran fuera.

describe("CONTACT_TYPE_ORDER (#730)", () => {
  it("tiene los 9 tipos vigentes, sin repetidos (#929: sin Referido)", () => {
    expect(CONTACT_TYPE_ORDER).toHaveLength(9);
    expect(new Set(CONTACT_TYPE_ORDER).size).toBe(9);
  });

  it("incluye los que el z.enum a mano dejaba fuera", () => {
    // COMPRADOR es el DEFAULT del modelo en Prisma y el valor que escribe el intake:
    // el tipo por defecto del sistema no era seleccionable.
    for (const t of ["COMPRADOR", "EMPLEO"]) {
      expect(CONTACT_TYPE_ORDER as readonly string[]).toContain(t);
    }
  });

  it("cada tipo tiene su etiqueta en español", () => {
    for (const t of CONTACT_TYPE_ORDER) {
      expect(CONTACT_TYPE_LABELS[t], `${t} sin etiqueta`).toBeTruthy();
    }
  });

  it("no hay etiquetas huérfanas: cada etiqueta es de un tipo vigente o de uno retirado", () => {
    // La deriva va en las dos direcciones. Una etiqueta de un valor que ya no existe es
    // igual de engañosa que un valor sin etiqueta. Los retirados (#907) conservan la suya
    // solo para mostrar cambios viejos en la cronología.
    const conocidos = [...CONTACT_TYPE_ORDER, ...Object.keys(CONTACT_TYPE_RETIRADOS)];
    for (const t of Object.keys(CONTACT_TYPE_LABELS)) {
      expect(conocidos).toContain(t);
    }
  });
});

describe("Tipos de contacto del #907 (Broker, Proveedor, Otro; sin Referidor)", () => {
  it("«Broker externo» se muestra como «Broker»", () => {
    expect(CONTACT_TYPE_LABELS.BROKER_EXTERNO).toBe("Broker");
  });

  it("Proveedor y Otro se ofrecen, con su etiqueta", () => {
    expect(CONTACT_TYPE_ORDER as readonly string[]).toContain("PROVEEDOR");
    expect(CONTACT_TYPE_ORDER as readonly string[]).toContain("OTRO");
    expect(CONTACT_TYPE_LABELS.PROVEEDOR).toBe("Proveedor");
    expect(CONTACT_TYPE_LABELS.OTRO).toBe("Otro");
  });

  it("ni Referidor (#907) ni Referido (#929) se ofrecen", () => {
    expect(CONTACT_TYPE_ORDER as readonly string[]).not.toContain("REFERIDOR");
    expect(CONTACT_TYPE_ORDER as readonly string[]).not.toContain("REFERIDO");
  });

  it("ningún tipo retirado está también en la lista vigente, y cada uno apunta a uno vigente o a «sin tipo»", () => {
    for (const [viejo, nuevo] of Object.entries(CONTACT_TYPE_RETIRADOS)) {
      expect(CONTACT_TYPE_ORDER as readonly string[]).not.toContain(viejo);
      if (nuevo !== null) expect(CONTACT_TYPE_ORDER as readonly string[]).toContain(nuevo);
    }
  });

  it("#929: REFERIDO de una entrada externa sale como «no viene tipo» (undefined)", () => {
    expect(normalizarTipoContacto("REFERIDO")).toBeUndefined();
    expect(CONTACT_TYPE_LABELS.REFERIDO).toBe("Referido"); // sigue leyéndose en la cronología
  });

  it("normalizarTipoContacto traduce REFERIDOR a Broker y deja todo lo demás igual", () => {
    expect(normalizarTipoContacto("REFERIDOR")).toBe("BROKER_EXTERNO");
    expect(normalizarTipoContacto("COMPRADOR")).toBe("COMPRADOR");
    expect(normalizarTipoContacto("VENDEDOR")).toBe("VENDEDOR"); // lo inválido lo rechaza el z.enum
    expect(normalizarTipoContacto(null)).toBeNull();
    expect(normalizarTipoContacto(undefined)).toBeUndefined();
    // Una clave del prototipo no es un tipo retirado.
    expect(normalizarTipoContacto("toString")).toBe("toString");
  });
});

describe("Paridad con el enum ContactType de schema.prisma (#907)", () => {
  // Lee el esquema como texto: no necesita el cliente de Prisma generado, así que corre en
  // cualquier entorno. Vigentes + retirados = el enum completo, ni uno más ni uno menos.
  it("CONTACT_TYPE_ORDER + retirados son exactamente los valores del enum", () => {
    const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    const bloque = schema.match(/enum ContactType \{([\s\S]*?)\}/);
    expect(bloque, "no se encontró enum ContactType en schema.prisma").toBeTruthy();
    const valores = bloque![1]
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter((l) => /^[A-Z_]+$/.test(l));
    const esperados = [...CONTACT_TYPE_ORDER, ...Object.keys(CONTACT_TYPE_RETIRADOS)];
    expect([...valores].sort()).toEqual([...esperados].sort());
  });
});
