import { describe, it, expect } from "vitest";
import { construirFicha } from "./ficha";
import type { DesarrolloReclutamiento } from "@/lib/hub/reclutamiento-inventario";

const BASE = "Propyte es una comercializadora inmobiliaria. Buscamos asesores.";
const OFICINAS =
  "Oficinas: Playa del Carmen, Quinta Avenida esquina con calle 40 (ubicación privilegiada, en plena Quinta).\n" +
  "Mérida: oficina de ventas de Yaxnáh Caucel, en Ciudad Caucel.";

const dev = (nombre: string, ciudad: string | null, relacion: DesarrolloReclutamiento["relacion"], tipos: string[]): DesarrolloReclutamiento =>
  ({ nombre, ciudad, relacion, tipos, disponibles: null });

describe("construirFicha", () => {
  it("con 3 exclusivos y co-broker en 2 ciudades: base, oficinas, exclusivos y resumen co-broker por ciudad", () => {
    const devs = [
      dev("Gran Coralia", "Tulum", "CO_BROKER", ["Terreno"]),
      dev("Yaxnáh Caucel", "Mérida", "EXCLUSIVO", ["Casa"]),
      dev("Lote PDC 1", "Playa del Carmen", "CO_BROKER", ["Terreno"]),
      dev("Turena", "Telchac", "EXCLUSIVO", ["Departamento", "Penthouse"]),
      dev("Torre PDC", "Playa del Carmen", "CO_BROKER", ["Departamento", "Local"]),
      dev("Nativa Tulum", "Tulum", "EXCLUSIVO", ["Departamento", "Penthouse"]),
      dev("Villas PDC", "Playa del Carmen", "CO_BROKER", ["Villa", "Terreno"]),
    ];
    expect(construirFicha(BASE, devs)).toBe(
      `${BASE}\n${OFICINAS}\n` +
        "Desarrollos exclusivos de Propyte (producto propio): Yaxnáh Caucel (casas, Mérida); " +
        "Turena (departamentos y penthouses, Telchac); Nativa Tulum (departamentos y penthouses, Tulum).\n" +
        "Además comercializamos inventario de otros desarrolladores (co-broker): " +
        "Playa del Carmen: 3 desarrollos (terrenos, departamentos, locales, villas); Tulum: 1 (terrenos).",
    );
  });

  it("sin desarrollos: solo base y oficinas (la ficha base ya habla del inventario)", () => {
    expect(construirFicha(BASE, [])).toBe(`${BASE}\n${OFICINAS}`);
  });

  it("no menciona precios ni nombres de co-broker, y los referidos no cuentan como inventario", () => {
    const devs = [
      dev("Gran Coralia", "Tulum", "CO_BROKER", ["Terreno"]),
      dev("Aliado", "Cancún", "REFERIDOS", ["Departamento"]),
    ];
    const ficha = construirFicha(BASE, devs);
    expect(ficha).not.toContain("Gran Coralia");
    expect(ficha).not.toContain("Aliado");
    expect(ficha).not.toContain("Cancún");
    expect(ficha).not.toContain("Desarrollos exclusivos");
    expect(ficha).toContain("(co-broker): Tulum: 1 desarrollo (terrenos).");
  });

  it("un exclusivo sin tipos ni ciudad no deja paréntesis vacíos; ciudad desconocida se agrupa como «otras zonas»", () => {
    const devs = [dev("Misterio", null, "EXCLUSIVO", []), dev("X", null, "CO_BROKER", ["Casa"])];
    const ficha = construirFicha(BASE, devs);
    expect(ficha).toContain("(producto propio): Misterio.");
    expect(ficha).toContain("(co-broker): otras zonas: 1 desarrollo (casas).");
  });
});
