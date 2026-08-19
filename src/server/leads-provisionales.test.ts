// Guardia de los cuatro tableros que cuentan leads: ninguno debe contar al
// contacto provisional nacido de un comentario que nunca contestó.
//
// Se prueba el `where` que cada tablero le pasa a Prisma, no la respuesta de
// Prisma: lo que puede romperse aquí es que alguien quite el filtro de un
// tablero (o agregue un tablero nuevo sin él), y eso es exactamente lo que
// estas aserciones detectan. El significado del filtro se prueba aparte, en
// lib/leads/real-leads.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PROVISIONAL_COMMENT_LEAD } from "@/lib/leads/real-leads";

const contactCount = vi.fn();
const contactGroupBy = vi.fn();
const contactFindMany = vi.fn();
const dealCount = vi.fn();
const dealAggregate = vi.fn();
const genericCount = vi.fn();
const genericFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      count: (...a: unknown[]) => contactCount(...a),
      groupBy: (...a: unknown[]) => contactGroupBy(...a),
      findMany: (...a: unknown[]) => contactFindMany(...a),
    },
    deal: {
      count: (...a: unknown[]) => dealCount(...a),
      aggregate: (...a: unknown[]) => dealAggregate(...a),
      findMany: (...a: unknown[]) => genericFindMany(...a),
      groupBy: (...a: unknown[]) => genericFindMany(...a),
    },
    quote: {
      count: (...a: unknown[]) => genericCount(...a),
      findMany: (...a: unknown[]) => genericFindMany(...a),
    },
    activity: {
      count: (...a: unknown[]) => genericCount(...a),
      findMany: (...a: unknown[]) => genericFindMany(...a),
    },
    slaTimer: {
      count: (...a: unknown[]) => genericCount(...a),
      findMany: (...a: unknown[]) => genericFindMany(...a),
    },
    conversation: {
      count: (...a: unknown[]) => genericCount(...a),
      findMany: (...a: unknown[]) => genericFindMany(...a),
    },
    visit: {
      count: (...a: unknown[]) => genericCount(...a),
      findMany: (...a: unknown[]) => genericFindMany(...a),
    },
    teamMember: { findMany: (...a: unknown[]) => genericFindMany(...a) },
    user: { findFirst: () => Promise.resolve(null), findMany: (...a: unknown[]) => genericFindMany(...a) },
  },
}));

const session = { user: { id: "u1", role: "ADMIN", name: "Luis" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

beforeEach(() => {
  for (const m of [contactCount, contactGroupBy, contactFindMany, dealCount, dealAggregate, genericCount, genericFindMany]) {
    m.mockReset();
  }
  contactCount.mockResolvedValue(0);
  contactGroupBy.mockResolvedValue([]);
  contactFindMany.mockResolvedValue([]);
  dealCount.mockResolvedValue(0);
  dealAggregate.mockResolvedValue({ _avg: { estimatedValue: null }, _sum: { estimatedValue: null } });
  genericCount.mockResolvedValue(0);
  genericFindMany.mockResolvedValue([]);
});

/** El filtro puede llegar como objeto único o dentro del arreglo de NOT. */
function excluyeProvisionales(where: Record<string, unknown> | undefined): boolean {
  const not = where?.NOT;
  if (!not) return false;
  const list = Array.isArray(not) ? not : [not];
  return list.some((n) => JSON.stringify(n) === JSON.stringify(PROVISIONAL_COMMENT_LEAD));
}

describe("/reportes — fuentes de leads", () => {
  it("no cuenta a los provisionales que nunca contestaron", async () => {
    const { getLeadSourcesReport } = await import("./reports");
    await getLeadSourcesReport({});
    expect(excluyeProvisionales(contactGroupBy.mock.calls[0][0].where)).toBe(true);
  });

  it("mantiene el filtro de fechas que ya aplicaba", async () => {
    const { getLeadSourcesReport } = await import("./reports");
    await getLeadSourcesReport({ dateFrom: "2026-08-01" });
    const where = contactGroupBy.mock.calls[0][0].where;
    expect(where.createdAt.gte).toEqual(new Date("2026-08-01"));
    expect(excluyeProvisionales(where)).toBe(true);
  });
});

describe("metas — CAPTACIONES", () => {
  it("no cuenta a los provisionales que nunca contestaron", async () => {
    const { computeActual } = await import("./goals");
    await computeActual({
      metric: "CAPTACIONES",
      scope: "COMPANY",
      userId: null,
      teamId: null,
      period: new Date("2026-08-01T00:00:00Z"),
      currency: "MXN",
    });
    expect(excluyeProvisionales(contactCount.mock.calls[0][0].where)).toBe(true);
  });
});

describe("tablero — leads nuevos del mes", () => {
  it("ninguno de los dos conteos del mes cuenta provisionales", async () => {
    const { getDashboardStats } = await import("./dashboard");
    await getDashboardStats("u1", "ADMIN");
    expect(contactCount.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of contactCount.mock.calls) {
      expect(excluyeProvisionales(call[0].where)).toBe(true);
    }
  });
});

describe("Vista Hoy — leads nuevos sin tocar", () => {
  it("no lista ni cuenta provisionales", async () => {
    const { getTodayView } = await import("./today");
    await getTodayView("u1", "ADMIN");
    expect(excluyeProvisionales(contactCount.mock.calls[0][0].where)).toBe(true);
    expect(excluyeProvisionales(contactFindMany.mock.calls[0][0].where)).toBe(true);
  });
});
