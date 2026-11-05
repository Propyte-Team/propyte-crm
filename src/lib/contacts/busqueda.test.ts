import { describe, it, expect } from "vitest";
import { palabrasDeBusqueda, whereBusquedaContacto, whereNombreCompleto, MAX_PALABRAS_BUSQUEDA } from "./busqueda";

// #960: «Camilo Aguilar» no encontraba a «Camilo René» «Aguilar Pino» porque el texto entero se
// comparaba contra el nombre y contra el apellido por separado. Aquí se evalúa la condición
// contra contactos de ejemplo con la misma semántica que Postgres (`contains`, `insensitive`).

type Fila = { firstName: string; lastName: string; email: string | null; phone: string };
type Where = Record<string, unknown>;

function cumple(fila: Fila, where: Where): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "AND") return (v as Where[]).every((w) => cumple(fila, w));
    if (k === "OR") return (v as Where[]).some((w) => cumple(fila, w));
    const { contains, mode } = v as { contains: string; mode?: string };
    const valor = (fila as Record<string, string | null>)[k] ?? "";
    return mode === "insensitive" ? valor.toLowerCase().includes(contains.toLowerCase()) : valor.includes(contains);
  });
}

const CONTACTOS: Fila[] = [
  { firstName: "Camilo René", lastName: "Aguilar Pino", email: "camilo@ejemplo.mx", phone: "+529841110000" },
  { firstName: "Camila", lastName: "Aguirre", email: null, phone: "+529842220000" },
  { firstName: "Ana", lastName: "López", email: "ana.lopez@ejemplo.mx", phone: "+529843330000" },
];

const buscar = (texto: string, opts?: Parameters<typeof whereBusquedaContacto>[1]) => {
  const where = whereBusquedaContacto(texto, opts);
  return where ? CONTACTOS.filter((c) => cumple(c, where as Where)).map((c) => `${c.firstName} ${c.lastName}`) : [];
};

describe("whereBusquedaContacto — nombre completo (#960)", () => {
  it.each(["Camilo Aguilar", "aguilar camilo", "Camilo René Aguilar Pino", "camilo agui", "  Camilo   Aguilar  "])(
    "«%s» encuentra a Camilo René Aguilar Pino",
    (texto) => {
      expect(buscar(texto)).toEqual(["Camilo René Aguilar Pino"]);
    },
  );

  it("palabras cortas encuentran a todos los que las tienen («cam agui»: Camilo y Camila)", () => {
    expect(buscar("cam agui")).toEqual(["Camilo René Aguilar Pino", "Camila Aguirre"]);
  });

  it("una palabra que no está en ninguno de los dos campos no encuentra a nadie", () => {
    expect(buscar("Camilo Pérez")).toEqual([]);
  });

  it("una sola palabra se comporta como antes: nombre o apellido", () => {
    expect(buscar("Agui")).toEqual(["Camilo René Aguilar Pino", "Camila Aguirre"]);
    expect(buscar("lópez")).toEqual(["Ana López"]);
  });

  it("el correo y el teléfono se siguen buscando con el texto entero", () => {
    expect(buscar("ana.lopez@")).toEqual(["Ana López"]);
    expect(buscar("9842220")).toEqual(["Camila Aguirre"]);
  });

  it("solo_digitos: «+52 984 111» encuentra el teléfono +529841110000", () => {
    expect(buscar("+52 984 111", { telefono: "solo_digitos" })).toEqual(["Camilo René Aguilar Pino"]);
  });

  it("sin correo ni teléfono (Inbox sin correo): solo nombre y teléfono", () => {
    expect(buscar("camilo@ejemplo", { email: false })).toEqual([]);
  });

  it("texto vacío: sin condición", () => {
    expect(whereBusquedaContacto("   ")).toBeNull();
    expect(whereNombreCompleto(undefined)).toBeNull();
  });

  it(`a lo más ${MAX_PALABRAS_BUSQUEDA} palabras`, () => {
    expect(palabrasDeBusqueda("a b c d e f g")).toHaveLength(MAX_PALABRAS_BUSQUEDA);
  });
});
