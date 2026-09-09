import { describe, it, expect } from "vitest";
import { CONTACT_TYPE_ORDER, CONTACT_TYPE_LABELS } from "./constants";

// Tarjeta #730, la mitad de ContactType. Hermana de constants.lead-source.test.ts y por
// el mismo motivo: los z.enum escritos a mano se desincronizan del enum de Prisma sin que
// nada avise. Única fuente de verdad = CONTACT_TYPE_ORDER.
//
// La paridad estricta contra el enum de Prisma se comprueba abajo con `$Enums`, que
// necesita el cliente generado. Las dos primeras pruebas NO lo necesitan, así que corren
// también en entornos donde ese cliente no se puede descargar — y son las que fijan lo que
// de verdad se rompió: que COMPRADOR y los otros dos estuvieran fuera.

describe("CONTACT_TYPE_ORDER (#730)", () => {
  it("tiene los 9 tipos, sin repetidos", () => {
    expect(CONTACT_TYPE_ORDER).toHaveLength(9);
    expect(new Set(CONTACT_TYPE_ORDER).size).toBe(9);
  });

  it("incluye los tres que el z.enum a mano dejaba fuera", () => {
    // COMPRADOR es el DEFAULT del modelo en Prisma y el valor que escribe el intake:
    // el tipo por defecto del sistema no era seleccionable.
    for (const t of ["COMPRADOR", "REFERIDOR", "EMPLEO"]) {
      expect(CONTACT_TYPE_ORDER as readonly string[]).toContain(t);
    }
  });

  it("cada tipo tiene su etiqueta en español", () => {
    for (const t of CONTACT_TYPE_ORDER) {
      expect(CONTACT_TYPE_LABELS[t], `${t} sin etiqueta`).toBeTruthy();
    }
  });

  it("no hay etiquetas huérfanas: cada etiqueta corresponde a un tipo de la lista", () => {
    // La deriva va en las dos direcciones. Una etiqueta de un valor que ya no existe es
    // igual de engañosa que un valor sin etiqueta.
    for (const t of Object.keys(CONTACT_TYPE_LABELS)) {
      expect(CONTACT_TYPE_ORDER as readonly string[]).toContain(t);
    }
  });
});
