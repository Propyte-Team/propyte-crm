// Reportes por marca (el dashboard se retiró en #890) (2026-10-12, entrega 3, decisión 4 del dueño): sin selector,
// pero quien no es ADMIN solo ve cifras de sus marcas. Se prueba el `where` que cada consulta le
// pasa a Prisma: con un no-ADMIN el recorte va en AND; con ADMIN no aparece.
// #893: aquí se usa DIRECTOR, que ve toda la empresa por rol, para que en el AND quede SOLO el
// recorte de marca. El alcance por rol (GERENTE, TEAM_LEADER…) se prueba en reportes.alcance-rol.test.ts.
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
      aggregate: (a: Record<string, unknown>) =>
        spy("deal.aggregate", { _sum: { commissionTotal: null, estimatedValue: null }, _avg: { estimatedValue: null } })(a),
    },
    contact: {
      groupBy: (a: Record<string, unknown>) => spy("contact.groupBy", [{ leadSource: "META_ADS", _count: { id: 3 } }])(a),
      count: (a: Record<string, unknown>) => spy("contact.count", 0)(a),
    },
    activity: {
      findMany: (a: Record<string, unknown>) => spy("activity.findMany", [])(a),
      groupBy: (a: Record<string, unknown>) => spy("activity.groupBy", [])(a),
    },
    user: {
      findMany: (a: Record<string, unknown>) =>
        spy("user.findMany", [{ id: "ase-1", name: "Ana", _count: { deals: 0 }, deals: [], activities: [] }])(a),
    },
  },
}));

let sesion = { user: { id: "ger-1", role: "DIRECTOR", plaza: "PDC" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));

const getVisibleBrands = vi.fn();
const inventario = vi.fn();
vi.mock("@/lib/hub/catalog", () => ({ inventarioParaReporte: (...a: unknown[]) => inventario(...a) }));
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import {
  getPipelineReport,
  getAbsorptionReport,
  getCommissionsReport,
  getActivitiesReport,
  getLeadSourcesReport,
  getForecastReport,
  getLostDealsReport,
} from "./reports";

const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };
const contacto = (u: string) => ({
  OR: [{ assignedToId: u }, { brands: { some: { brandId: { in: ["b-def"] } } } }, { brands: { none: {} } }],
});
const negocio = (u: string) => ({ OR: [{ assignedToId: u }, { contact: contacto(u) }] });
const actividad = (u: string) => ({
  OR: [
    { contact: { is: contacto(u) } },
    { contactId: null, deal: { is: negocio(u) } },
    { contactId: null, dealId: null },
  ],
});

const whereOf = (name: string, i = 0) => calls[name]?.[i]?.where as Record<string, unknown> | undefined;
const allWheres = (name: string) => (calls[name] ?? []).map((c) => c.where as Record<string, unknown>);

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  getVisibleBrands.mockReset();
  inventario.mockReset();
  inventario.mockResolvedValue({ data: [], error: null });
  getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
  sesion = { user: { id: "ger-1", role: "DIRECTOR", plaza: "PDC" } };
});

describe("reportes — no-ADMIN: recorte por marca en AND", () => {
  it("pipeline: groupBy y findMany con el recorte; el filtro de plaza sigue suelto", async () => {
    await getPipelineReport({ plaza: "PDC" });
    for (const w of [whereOf("deal.groupBy"), whereOf("deal.findMany")]) {
      expect(w?.AND).toEqual([negocio("ger-1")]);
      expect(w?.assignedTo).toEqual({ plaza: "PDC" });
    }
    expect(getVisibleBrands).toHaveBeenCalledWith(sesion.user);
  });

  it("comisiones", async () => {
    await getCommissionsReport({});
    expect(whereOf("deal.findMany")?.AND).toEqual([negocio("ger-1")]);
    expect(whereOf("deal.findMany")?.stage).toBe("WON");
  });

  it("actividades: por el contacto de la actividad (o su negocio)", async () => {
    await getActivitiesReport({ advisorId: "ase-1" });
    expect(whereOf("activity.findMany")?.AND).toEqual([actividad("ger-1")]);
    expect(whereOf("activity.findMany")?.userId).toBe("ase-1");
  });

  it("fuentes de leads: contactos Y negocios con la misma regla", async () => {
    await getLeadSourcesReport({});
    expect(whereOf("contact.groupBy")?.AND).toEqual([contacto("ger-1")]);
    for (const w of allWheres("deal.count")) expect(w.AND).toEqual([negocio("ger-1")]);
    expect(whereOf("deal.aggregate")?.AND).toEqual([negocio("ger-1")]);
  });

  it("forecast", async () => {
    await getForecastReport({ advisorId: "ase-1" });
    expect(whereOf("deal.findMany")?.AND).toEqual([negocio("ger-1")]);
    expect(whereOf("deal.findMany")?.assignedToId).toBe("ase-1");
  });

  it("negocios perdidos", async () => {
    await getLostDealsReport({});
    expect(whereOf("deal.findMany")?.AND).toEqual([negocio("ger-1")]);
  });

  it("absorción: sin recorte (inventario del Hub, sin contactos ni negocios)", async () => {
    await getAbsorptionReport({});
    expect(inventario).toHaveBeenCalledTimes(1);
    expect(getVisibleBrands).not.toHaveBeenCalled();
  });
});

describe("reportes — ADMIN: sin recorte", () => {
  beforeEach(() => {
    sesion = { user: { id: "adm-1", role: "ADMIN", plaza: "CANCUN" } };
    getVisibleBrands.mockResolvedValue("ALL");
  });

  it("ninguna consulta lleva AND de marca", async () => {
    await getPipelineReport({});
    await getCommissionsReport({});
    await getActivitiesReport({});
    await getLeadSourcesReport({});
    await getForecastReport({});
    await getLostDealsReport({});
    for (const name of ["deal.groupBy", "deal.findMany", "deal.count", "deal.aggregate", "activity.findMany", "contact.groupBy"]) {
      for (const w of allWheres(name)) expect(w.AND, name).toBeUndefined();
    }
  });
});
