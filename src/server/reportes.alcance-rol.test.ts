// #893: las consultas de /reports solo pedían sesión. Un asesor que escribía la URL veía las
// comisiones de todos, y GERENTE/TEAM_LEADER veían la empresa entera. Aquí se prueba, contra el
// `where` que cada consulta le pasa a Prisma, que:
//   · un rol sin Reportes en el menú no llega a la base,
//   · el alcance por rol va en AND junto al recorte de marca y el filtro de la pantalla no lo pisa,
//   · Absorción lee el inventario del Hub,
//   · las fechas se anclan a Cancún.
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: Record<string, Array<Record<string, unknown>>> = {};
function spy(name: string, value: unknown) {
  return (args: Record<string, unknown>) => {
    (calls[name] ??= []).push(args);
    return Promise.resolve(value);
  };
}

vi.mock("@/lib/db", () => ({
  default: {
    deal: {
      groupBy: (a: Record<string, unknown>) => spy("deal.groupBy", [])(a),
      findMany: (a: Record<string, unknown>) => spy("deal.findMany", [])(a),
      count: (a: Record<string, unknown>) => spy("deal.count", 0)(a),
      aggregate: (a: Record<string, unknown>) => spy("deal.aggregate", { _avg: { estimatedValue: null } })(a),
    },
    contact: {
      groupBy: (a: Record<string, unknown>) => spy("contact.groupBy", [{ leadSource: "WHATSAPP", _count: { id: 2 } }])(a),
    },
    activity: { findMany: (a: Record<string, unknown>) => spy("activity.findMany", [])(a) },
    user: { findMany: (a: Record<string, unknown>) => spy("user.findMany", [])(a) },
  },
}));

let sesion: { user: { id: string; role: string; plaza: string } } | null = null;
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

const inventario = vi.fn();
vi.mock("@/lib/hub/catalog", () => ({ inventarioParaReporte: (...a: unknown[]) => inventario(...a) }));

import {
  getPipelineReport,
  getAbsorptionReport,
  getCommissionsReport,
  getActivitiesReport,
  getLeadSourcesReport,
  getForecastReport,
  getLostDealsReport,
} from "./reports";

const REPORTES = {
  pipeline: getPipelineReport,
  absorcion: getAbsorptionReport,
  comisiones: getCommissionsReport,
  actividades: getActivitiesReport,
  fuentes: getLeadSourcesReport,
  forecast: getForecastReport,
  perdidos: getLostDealsReport,
};

const whereOf = (name: string, i = 0) => calls[name]?.[i]?.where as Record<string, unknown> | undefined;
const totalLlamadas = () => Object.values(calls).reduce((n, c) => n + c.length, 0);

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  getVisibleBrands.mockReset();
  getVisibleBrands.mockResolvedValue("ALL"); // aísla el alcance por rol del recorte de marca
  inventario.mockReset();
  inventario.mockResolvedValue({ data: [], error: null });
  sesion = null;
});

describe("puerta: quien no tiene Reportes en el menú no llega a la base", () => {
  it.each(["ASESOR", "ASESOR_SR", "ASESOR_JR", "HOSTESS", "BROKER", "DEVELOPER_EXT"])(
    "%s recibe «No autorizado» en los 7 reportes",
    async (role) => {
      sesion = { user: { id: "u1", role, plaza: "PDC" } };
      for (const [nombre, reporte] of Object.entries(REPORTES)) {
        await expect(reporte({}), nombre).rejects.toThrow("No autorizado");
      }
      expect(totalLlamadas()).toBe(0);
      expect(inventario).not.toHaveBeenCalled();
    },
  );

  it("sin sesión, igual que antes", async () => {
    await expect(getPipelineReport({})).rejects.toThrow("No autorizado");
  });
});

describe("alcance por rol, en AND", () => {
  it("GERENTE: pipeline acotado a su plaza; el filtro de plaza de la pantalla no lo reemplaza", async () => {
    sesion = { user: { id: "g1", role: "GERENTE", plaza: "MERIDA" } };
    await getPipelineReport({ plaza: "PDC" });
    for (const w of [whereOf("deal.groupBy"), whereOf("deal.findMany")]) {
      expect(w?.AND).toEqual([{ OR: [{ assignedToId: "g1" }, { assignedTo: { plaza: "MERIDA" } }] }]);
      // Pide PDC: la intersección con su plaza (MERIDA) no devuelve nada ajeno.
      expect(w?.assignedTo).toEqual({ plaza: "PDC" });
    }
  });

  it("GERENTE: el ?advisorId= de otro asesor se intersecta con su alcance, no lo pisa", async () => {
    sesion = { user: { id: "g1", role: "GERENTE", plaza: "MERIDA" } };
    await getForecastReport({ advisorId: "asesor-de-otra-plaza" });
    const w = whereOf("deal.findMany");
    expect(w?.assignedToId).toBe("asesor-de-otra-plaza");
    expect(w?.AND).toEqual([{ OR: [{ assignedToId: "g1" }, { assignedTo: { plaza: "MERIDA" } }] }]);
  });

  it("TEAM_LEADER: actividades de su equipo, no de la plaza", async () => {
    sesion = { user: { id: "tl1", role: "TEAM_LEADER", plaza: "PDC" } };
    await getActivitiesReport({});
    expect(whereOf("activity.findMany")?.AND).toEqual([
      { OR: [{ userId: "tl1" }, { user: { teamLeaderId: "tl1" } }] },
    ]);
  });

  it("TEAM_LEADER: fuentes de leads acota contactos Y negocios", async () => {
    sesion = { user: { id: "tl1", role: "TEAM_LEADER", plaza: "PDC" } };
    await getLeadSourcesReport({});
    expect(whereOf("contact.groupBy")?.AND).toEqual([
      { OR: [{ assignedToId: "tl1" }, { assignedTo: { is: { teamLeaderId: "tl1" } } }] },
    ]);
    for (const c of calls["deal.count"] ?? []) {
      expect((c.where as Record<string, unknown>).AND).toEqual([
        { OR: [{ assignedToId: "tl1" }, { assignedTo: { teamLeaderId: "tl1" } }] },
      ]);
    }
  });

  it("MARKETING ve todo en pipeline, pero en comisiones solo las suyas (como en /commissions)", async () => {
    sesion = { user: { id: "mk1", role: "MARKETING", plaza: "PDC" } };
    await getPipelineReport({});
    expect(whereOf("deal.findMany")?.AND).toBeUndefined();
    await getCommissionsReport({});
    expect(whereOf("deal.findMany", 1)?.AND).toEqual([{ assignedToId: "mk1" }]);
  });

  it("DIRECTOR: comisiones de todos", async () => {
    sesion = { user: { id: "d1", role: "DIRECTOR", plaza: "PDC" } };
    await getCommissionsReport({});
    expect(whereOf("deal.findMany")?.AND).toBeUndefined();
  });

  it("rol y marca juntos: los dos quedan en el AND", async () => {
    sesion = { user: { id: "g1", role: "GERENTE", plaza: "TULUM" } };
    getVisibleBrands.mockResolvedValue({ brandIds: ["b-def"], includesDefault: true });
    await getLostDealsReport({});
    const and = whereOf("deal.findMany")?.AND as unknown[];
    expect(and).toHaveLength(2);
    expect(and[0]).toEqual({ OR: [{ assignedToId: "g1" }, { assignedTo: { plaza: "TULUM" } }] });
  });
});

describe("fechas en hora de Cancún", () => {
  it("pipeline: gte medianoche de Cancún del «desde», lt medianoche del día siguiente al «hasta»", async () => {
    sesion = { user: { id: "a1", role: "ADMIN", plaza: "PDC" } };
    await getPipelineReport({ dateFrom: "2026-10-01", dateTo: "2026-10-15" });
    expect(whereOf("deal.findMany")?.createdAt).toEqual({
      gte: new Date("2026-10-01T05:00:00.000Z"),
      lt: new Date("2026-10-16T05:00:00.000Z"),
    });
  });

  it("comisiones (actualCloseDate) y perdidos (updatedAt) usan el mismo rango", async () => {
    sesion = { user: { id: "a1", role: "ADMIN", plaza: "PDC" } };
    await getCommissionsReport({ dateTo: "2026-10-15" });
    await getLostDealsReport({ dateTo: "2026-10-15" });
    expect(whereOf("deal.findMany", 0)?.actualCloseDate).toEqual({ lt: new Date("2026-10-16T05:00:00.000Z") });
    expect(whereOf("deal.findMany", 1)?.updatedAt).toEqual({ lt: new Date("2026-10-16T05:00:00.000Z") });
  });

  it("una fecha imposible es un error, no un rango equivocado", async () => {
    sesion = { user: { id: "a1", role: "ADMIN", plaza: "PDC" } };
    await expect(getActivitiesReport({ dateFrom: "2026-02-30" })).rejects.toThrow("Fecha inválida");
  });
});

describe("absorción desde el inventario del Hub", () => {
  const fila = {
    id: "dev-1",
    name: "Nativa Tulum",
    plaza: "TULUM",
    totalUnits: 73,
    publishedUnits: 8,
    availableUnits: 5,
    reservedUnits: 1,
    soldUnits: 2,
    soldWithDate: 0,
    soldInWindow: 0,
    avgPriceMxn: 4326922.4,
  };

  it("cuenta las unidades publicadas y traduce la plaza del Hub a la etiqueta del CRM", async () => {
    sesion = { user: { id: "d1", role: "DIRECTOR", plaza: "PDC" } };
    inventario.mockResolvedValue({ data: [fila, { ...fila, id: "dev-2", plaza: null, publishedUnits: 0, soldUnits: 0, avgPriceMxn: null }], error: null });
    const filas = await getAbsorptionReport({});
    expect(filas[0]).toMatchObject({
      developmentName: "Nativa Tulum",
      plaza: "Tulum",
      publishedUnits: 8,
      soldUnits: 2,
      soldPct: 25,
      // Sin ninguna fecha de venta registrada: «-», no un 0.
      absorptionRate: null,
      avgPrice: 4326922,
    });
    expect(filas[1]).toMatchObject({ plaza: "Sin plaza", soldPct: null, avgPrice: null });
  });

  it("ventas por mes = vendidas con fecha en la ventana ÷ meses de la ventana", async () => {
    sesion = { user: { id: "d1", role: "DIRECTOR", plaza: "PDC" } };
    inventario.mockResolvedValue({ data: [{ ...fila, soldWithDate: 6, soldInWindow: 6 }], error: null });
    const [f] = await getAbsorptionReport({ dateFrom: "2026-01-01", dateTo: "2026-06-30" });
    expect(f.absorptionRate).toBe(1); // 6 ventas en ~6 meses
    const args = inventario.mock.calls[0][0];
    expect(args.vendidasDesde).toEqual(new Date("2026-01-01T05:00:00.000Z"));
    expect(args.vendidasAntesDe).toEqual(new Date("2026-07-01T05:00:00.000Z"));
  });

  it("el filtro de plaza se manda como el Hub la escribe: código y etiqueta, sin acentos", async () => {
    sesion = { user: { id: "d1", role: "DIRECTOR", plaza: "PDC" } };
    await getAbsorptionReport({ plaza: "MERIDA" });
    expect(inventario.mock.calls[0][0].plazas).toEqual(["merida"]);
    await getAbsorptionReport({ plaza: "PDC" });
    expect(inventario.mock.calls[1][0].plazas).toEqual(["pdc", "playa del carmen"]);
    await getAbsorptionReport({});
    expect(inventario.mock.calls[2][0].plazas).toBeNull();
  });

  it("si el Hub falla, es un error y no «sin datos»", async () => {
    sesion = { user: { id: "d1", role: "DIRECTOR", plaza: "PDC" } };
    inventario.mockResolvedValue({ data: [], error: "No se pudo consultar el catálogo del Hub" });
    await expect(getAbsorptionReport({})).rejects.toThrow("No se pudo consultar el catálogo del Hub");
  });
});
