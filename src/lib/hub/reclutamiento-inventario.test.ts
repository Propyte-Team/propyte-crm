import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryRaw = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a) },
}));

import { PUBLIC_GATE } from "./catalog";
import { desarrollosParaReclutamiento, _limpiarCacheInventarioReclutamiento } from "./reclutamiento-inventario";

const filas = [
  { nombre: "Yaxnáh Caucel", ciudad: "Mérida", relacion: "Exclusivo", tipos: ["Casa"], disponibles: 12 },
  { nombre: "Turena", ciudad: "Telchac", relacion: "exclusiva", tipos: ["Departamento", "Penthouse"], disponibles: 4 },
  { nombre: "Gran Coralia", ciudad: "Tulum", relacion: "Co-broker", tipos: ["Terreno"], disponibles: 20 },
  { nombre: "Ancestral", ciudad: "Tulum", relacion: "cobroker", tipos: ["Terreno"], disponibles: 3 },
  { nombre: "Sin dato", ciudad: "Playa del Carmen", relacion: null, tipos: null, disponibles: null },
  { nombre: "Aliado", ciudad: "Cancún", relacion: "Referidos", tipos: ["Departamento"], disponibles: 1 },
];

beforeEach(() => {
  queryRaw.mockReset();
  queryRaw.mockResolvedValue(filas);
  _limpiarCacheInventarioReclutamiento();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("desarrollosParaReclutamiento", () => {
  it("consulta v_developments con el gate público y las columnas de la ficha", async () => {
    await desarrollosParaReclutamiento();
    const sql = String(queryRaw.mock.calls[0][0]);
    expect(sql).toContain("real_estate_hub.v_developments");
    expect(sql).toContain(`WHERE ${PUBLIC_GATE}`);
    for (const col of ["d.name", "d.city", "d.crm_relationship", "d.property_types", "d.available_units"]) expect(sql).toContain(col);
  });

  it("normaliza la relación: exclus* → EXCLUSIVO, refer* → REFERIDOS, co-brok*/cobrok* y NULL → CO_BROKER", async () => {
    const devs = await desarrollosParaReclutamiento();
    const rel = Object.fromEntries(devs.map((d) => [d.nombre, d.relacion]));
    expect(rel).toEqual({
      "Yaxnáh Caucel": "EXCLUSIVO",
      Turena: "EXCLUSIVO",
      "Gran Coralia": "CO_BROKER",
      Ancestral: "CO_BROKER",
      "Sin dato": "CO_BROKER",
      Aliado: "REFERIDOS",
    });
  });

  it("tipos NULL → [] y disponibles NULL → null; el nombre es el real (d.name)", async () => {
    const devs = await desarrollosParaReclutamiento();
    const sinDato = devs.find((d) => d.nombre === "Sin dato")!;
    expect(sinDato).toEqual({ nombre: "Sin dato", ciudad: "Playa del Carmen", relacion: "CO_BROKER", tipos: [], disponibles: null });
  });

  it("cachea 10 minutos: la segunda llamada no consulta; tras el TTL vuelve a consultar", async () => {
    vi.useFakeTimers();
    try {
      await desarrollosParaReclutamiento();
      await desarrollosParaReclutamiento();
      expect(queryRaw).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);
      await desarrollosParaReclutamiento();
      expect(queryRaw).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("si el Hub falla devuelve [] con warn, nunca lanza, y no cachea el fallo", async () => {
    queryRaw.mockRejectedValueOnce(new Error("hub caído"));
    expect(await desarrollosParaReclutamiento()).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith("[reclutamiento] inventario del Hub no disponible", expect.any(Error));
    expect(await desarrollosParaReclutamiento()).toHaveLength(6);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
