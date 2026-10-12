// Reportes y dashboard por marca (2026-10-12, entrega 3, decisión 4 del dueño): sin selector,
// pero quien no es ADMIN solo ve cifras de sus marcas. Se prueba el `where` que cada consulta le
// pasa a Prisma: con un no-ADMIN el recorte va en AND; con ADMIN no aparece.
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
    development: { findMany: (a: Record<string, unknown>) => spy("development.findMany", [])(a) },
    user: {
      findMany: (a: Record<string, unknown>) =>
        spy("user.findMany", [{ id: "ase-1", name: "Ana", _count: { deals: 0 }, deals: [], activities: [] }])(a),
    },
  },
}));

let sesion = { user: { id: "ger-1", role: "GERENTE", plaza: "CANCUN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));

const getVisibleBrands = vi.fn();
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
import { getDashboardStats } from "./dashboard";

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
  getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
  sesion = { user: { id: "ger-1", role: "GERENTE", plaza: "CANCUN" } };
});

describe("reportes — no-ADMIN: recorte por marca en AND", () => {
  it("pipeline: groupBy y findMany con el recorte; el filtro de plaza sigue suelto", async () => {
    await getPipelineReport({ plaza: "CANCUN" });
    for (const w of [whereOf("deal.groupBy"), whereOf("deal.findMany")]) {
      expect(w?.AND).toEqual([negocio("ger-1")]);
      expect(w?.assignedTo).toEqual({ plaza: "CANCUN" });
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

  it("absorción: sin recorte (inventario de desarrollos, sin contactos ni negocios)", async () => {
    await getAbsorptionReport({});
    expect(whereOf("development.findMany")).toEqual({ deletedAt: null, isActive: true });
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

describe("dashboard — no-ADMIN", () => {
  it("todas las consultas de negocios, leads y actividades llevan el recorte", async () => {
    await getDashboardStats("ger-1", "GERENTE", "CANCUN");
    expect(getVisibleBrands).toHaveBeenCalledWith({ id: "ger-1", role: "GERENTE" });

    for (const name of ["deal.findMany", "deal.count", "deal.aggregate", "deal.groupBy"]) {
      const ws = allWheres(name);
      expect(ws.length, name).toBeGreaterThan(0);
      for (const w of ws) {
        expect(w.AND, name).toEqual([negocio("ger-1")]);
        // el alcance por rol del GERENTE sigue ahí
        expect(w.assignedTo, name).toEqual({ plaza: "CANCUN" });
      }
    }
    // leads nuevos del mes y del anterior
    const leads = allWheres("contact.count");
    expect(leads).toHaveLength(2);
    for (const w of leads) expect(w.AND).toEqual([contacto("ger-1")]);
    // actividades recientes y tareas vencidas (getOverdueTasks)
    for (const w of allWheres("activity.findMany")) expect(w.AND).toEqual([actividad("ger-1")]);
    expect(allWheres("activity.findMany")).toHaveLength(2);
    // por asesor: los usuarios no tienen marca, lo que se cuenta de ellos sí
    const advisorSelect = calls["user.findMany"].find((c) => c.select)!.select as {
      _count: { select: { deals: { where: Record<string, unknown> } } };
      deals: { where: Record<string, unknown> };
      activities: { where: Record<string, unknown> };
    };
    expect(advisorSelect._count.select.deals.where.AND).toEqual([negocio("ger-1")]);
    expect(advisorSelect.deals.where.AND).toEqual([negocio("ger-1")]);
    expect(advisorSelect.activities.where.AND).toEqual([actividad("ger-1")]);
    expect(whereOf("activity.groupBy")?.AND).toEqual([actividad("ger-1")]);
  });
});

describe("dashboard — ADMIN", () => {
  it("sin recorte de marca en ninguna consulta", async () => {
    sesion = { user: { id: "adm-1", role: "ADMIN", plaza: "CANCUN" } };
    getVisibleBrands.mockResolvedValue("ALL");
    await getDashboardStats("adm-1", "ADMIN");
    for (const name of ["deal.findMany", "deal.count", "deal.aggregate", "deal.groupBy", "contact.count", "activity.findMany"]) {
      for (const w of allWheres(name)) expect(w.AND, name).toBeUndefined();
    }
  });
});
