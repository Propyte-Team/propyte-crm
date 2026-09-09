import { describe, it, expect } from "vitest";

// Tarjeta #730. `src/lib/validations/contact.ts` conservaba la última copia a mano del
// enum LeadSource: 12 de los 21 valores. AUD-20260710-02 había centralizado la lista en
// LEAD_SOURCE_ORDER y la aplicó en el formulario, el listado, el detalle,
// server/contacts y api/contacts — este archivo se quedó fuera.
//
// La prueba de paridad contra el enum real de Prisma ya existe en
// src/lib/constants.lead-source.test.ts. Esta comprueba lo otro: que el esquema de
// validación acepte lo que esa lista dice, sin necesitar el cliente de Prisma generado
// (así corre también en el contenedor, donde el cliente no se puede descargar).

import { CONTACT_TYPE_ORDER, LEAD_SOURCE_ORDER } from "@/lib/constants";
import { createContactSchema, searchContactSchema } from "./contact";
import { ORDEN_POR_ENTIDAD } from "@/lib/api/orden";

/** Un contacto mínimo válido, al que solo se le cambia la fuente. */
function contactoCon(leadSource: string) {
  return {
    firstName: "Ana",
    lastName: "Pérez",
    phone: "+529841234567",
    leadSource,
  };
}

describe("createContactSchema — leadSource sale de LEAD_SOURCE_ORDER (#730)", () => {
  it("acepta los 21 valores de la lista, uno por uno", () => {
    for (const fuente of LEAD_SOURCE_ORDER) {
      const r = createContactSchema.safeParse(contactoCon(fuente));
      expect(r.success, `rechazó "${fuente}", que es un valor válido en la base`).toBe(true);
    }
  });

  it("acepta MESSENGER, que es por donde entran los prospectos hoy", () => {
    // El más concreto de los nueve que faltaban: en producción hay 24 contactos con
    // leadSource MESSENGER, el último de hoy. Con la lista vieja este parse fallaba.
    expect(createContactSchema.safeParse(contactoCon("MESSENGER")).success).toBe(true);
  });

  it("acepta los otros ocho que faltaban", () => {
    for (const fuente of [
      "TIKTOK_ADS", "META_ADS", "BASE_DE_DATOS", "SELF_GEN",
      "REGISTRO_BROKER", "WEBINAR", "LINKEDIN", "LLAMADA_ENTRANTE",
    ]) {
      expect(
        createContactSchema.safeParse(contactoCon(fuente)).success,
        `rechazó "${fuente}"`
      ).toBe(true);
    }
  });

  it("sigue rechazando lo que no está en la lista", () => {
    // El arreglo abre la lista a los 21 valores reales, no la deja pasar todo.
    expect(createContactSchema.safeParse(contactoCon("TIKTOK")).success).toBe(false);
    expect(createContactSchema.safeParse(contactoCon("")).success).toBe(false);
    expect(createContactSchema.safeParse(contactoCon("facebook_ads")).success).toBe(false);
  });

  it("la lista tiene 21 valores y ninguno repetido", () => {
    // Si alguien agrega un valor al enum de Prisma y no a LEAD_SOURCE_ORDER, quien avisa
    // es constants.lead-source.test.ts (necesita el cliente generado). Esto solo fija el
    // número para que un cambio accidental de la lista se note aquí también.
    expect(LEAD_SOURCE_ORDER).toHaveLength(21);
    expect(new Set(LEAD_SOURCE_ORDER).size).toBe(21);
  });
});

// #730, la otra mitad: el z.enum de contactType tenía 6 de los 9 valores.
describe("createContactSchema — contactType sale de CONTACT_TYPE_ORDER (#730)", () => {
  it("acepta los 9 tipos, uno por uno", () => {
    for (const tipo of CONTACT_TYPE_ORDER) {
      const r = createContactSchema.safeParse({ ...contactoCon("MESSENGER"), contactType: tipo });
      expect(r.success, `rechazó "${tipo}"`).toBe(true);
    }
  });

  it("acepta COMPRADOR, que es el valor por defecto del modelo", () => {
    // El más importante de los tres que faltaban: Prisma lo pone por defecto y el intake
    // lo escribe, así que el tipo con el que nace la mayoría de los contactos no era
    // elegible en este esquema.
    const r = createContactSchema.safeParse({ ...contactoCon("MESSENGER"), contactType: "COMPRADOR" });

    expect(r.success).toBe(true);
  });

  it("sigue siendo opcional y sigue rechazando lo inventado", () => {
    expect(createContactSchema.safeParse(contactoCon("MESSENGER")).success).toBe(true);
    expect(
      createContactSchema.safeParse({ ...contactoCon("MESSENGER"), contactType: "VENDEDOR" }).success
    ).toBe(false);
  });
});

// #745, la parte que quedó pendiente hasta que el PR #51 se mezcló: el `sortBy` de la
// búsqueda de contactos era texto libre, y la lista blanca de columnas vive en
// src/lib/api/orden.ts, que no existía en main cuando se hizo el resto.
describe("searchContactSchema — sortBy sale de la lista blanca (#745)", () => {
  it("acepta las columnas de la entidad contacto", () => {
    for (const columna of ORDEN_POR_ENTIDAD.contact.columnas) {
      expect(
        searchContactSchema.safeParse({ sortBy: columna }).success,
        `rechazó "${columna}", que sí es ordenable`
      ).toBe(true);
    }
  });

  it("rechaza una columna que el listado no expone", () => {
    // `custom` es un Json y `zohoId` es interno: ordenar por ellos nunca fue la intención.
    expect(searchContactSchema.safeParse({ sortBy: "custom" }).success).toBe(false);
    expect(searchContactSchema.safeParse({ sortBy: "zohoId" }).success).toBe(false);
    expect(searchContactSchema.safeParse({ sortBy: "noExiste" }).success).toBe(false);
  });

  it("rechaza el sentido mal escrito, que es el error de dedo típico", () => {
    expect(searchContactSchema.safeParse({ sortOrder: "ascending" }).success).toBe(false);
    expect(searchContactSchema.safeParse({ sortOrder: "DESC" }).success).toBe(false);
    expect(searchContactSchema.safeParse({ sortOrder: "asc" }).success).toBe(true);
  });

  it("los valores por defecto siguen siendo los de antes", () => {
    const r = searchContactSchema.parse({});

    expect(r.sortBy).toBe("createdAt");
    expect(r.sortOrder).toBe("desc");
  });
});
