import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #715, bugs A-03 y A-04 de la vista /hoy.
//
// A-03: `resolveOwnerIds` tenía su propia copia de las listas de roles —la tercera del
// repositorio— y HOSTESS no estaba en ninguna, así que caía en el `return undefined`
// final y veía el trabajo de toda la empresa.
// A-04: el rango del día se calculaba con setHours() sobre la zona del proceso, mientras
// /agenda agrupa en hora de Cancún.

const userFindMany = vi.fn();
const contactCount = vi.fn();
const contactFindMany = vi.fn();
const dealCount = vi.fn();
const dealFindMany = vi.fn();
const activityCount = vi.fn();
const activityFindMany = vi.fn();
const conversationCount = vi.fn();
const conversationFindMany = vi.fn();
const walkInCount = vi.fn();
const walkInFindMany = vi.fn();
const quoteCount = vi.fn();
const slaCount = vi.fn();
const slaFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    contact: {
      count: (...a: unknown[]) => contactCount(...a),
      findMany: (...a: unknown[]) => contactFindMany(...a),
    },
    deal: {
      count: (...a: unknown[]) => dealCount(...a),
      findMany: (...a: unknown[]) => dealFindMany(...a),
    },
    activity: {
      count: (...a: unknown[]) => activityCount(...a),
      findMany: (...a: unknown[]) => activityFindMany(...a),
    },
    conversation: {
      count: (...a: unknown[]) => conversationCount(...a),
      findMany: (...a: unknown[]) => conversationFindMany(...a),
    },
    walkIn: {
      count: (...a: unknown[]) => walkInCount(...a),
      findMany: (...a: unknown[]) => walkInFindMany(...a),
    },
    quote: { count: (...a: unknown[]) => quoteCount(...a) },
    slaTimer: {
      count: (...a: unknown[]) => slaCount(...a),
      findMany: (...a: unknown[]) => slaFindMany(...a),
    },
  },
}));

import { getTodayView } from "./today";

beforeEach(() => {
  userFindMany.mockReset().mockResolvedValue([{ id: "miembro-1" }]);
  for (const c of [contactCount, dealCount, activityCount, conversationCount, walkInCount, quoteCount, slaCount]) {
    c.mockReset().mockResolvedValue(0);
  }
  for (const f of [contactFindMany, dealFindMany, activityFindMany, conversationFindMany, walkInFindMany, slaFindMany]) {
    f.mockReset().mockResolvedValue([]);
  }
});

/** El `where` de la consulta de tareas, que es la que lleva userId y dueDate. */
function whereDeTareas(): Record<string, unknown> {
  const llamada = activityFindMany.mock.calls[0]?.[0] ?? activityCount.mock.calls[0]?.[0];
  return llamada.where;
}

describe("getTodayView — alcance por rol (#715 A-03)", () => {
  it("HOSTESS ve solo lo suyo, no el trabajo de toda la empresa", async () => {
    await getTodayView("user-1", "HOSTESS");

    // Antes: sin restricción. `resolveActivityScope` la clasifica OWN, como el resto
    // del CRM.
    expect(whereDeTareas().userId).toEqual({ in: ["user-1"] });
  });

  it("un asesor ve solo lo suyo", async () => {
    await getTodayView("user-1", "ASESOR_JR");
    expect(whereDeTareas().userId).toEqual({ in: ["user-1"] });
  });

  it("un team leader ve a su equipo", async () => {
    await getTodayView("user-1", "TEAM_LEADER");
    expect(whereDeTareas().userId).toEqual({ in: ["user-1", "miembro-1"] });
  });

  it("dirección ve todo", async () => {
    await getTodayView("user-1", "DIRECTOR");
    expect(whereDeTareas().userId).toBeUndefined();
  });

  it("un rol desconocido no ve nada, en vez de verlo todo", async () => {
    // El default anterior era "sin restricción", así que cualquier rol nuevo nacía
    // viendo la empresa entera.
    await getTodayView("user-1", "ROL_QUE_NO_EXISTE");
    expect(whereDeTareas().userId).toEqual({ in: [] });
  });
});

describe("getTodayView — el día es el de Cancún (#715 A-04)", () => {
  it("a las 23:30 UTC (18:30 en Cancún) el día sigue siendo el de Cancún, no el siguiente", async () => {
    // 2026-09-07T23:30Z = 2026-09-07 18:30 en Cancún. El fin del día tiene que ser la
    // medianoche de Cancún (2026-09-08T04:59:59.999Z), no la del proceso.
    vi.setSystemTime(new Date("2026-09-07T23:30:00.000Z"));

    await getTodayView("user-1", "ASESOR");

    const due = whereDeTareas().dueDate as { lte: Date };
    expect(due.lte.toISOString()).toBe("2026-09-08T04:59:59.999Z");

    vi.useRealTimers();
  });

  it("a las 03:00 UTC (22:00 del día anterior en Cancún) el día es el anterior", async () => {
    // Este es el caso que rompía: en UTC ya es día 8, en Cancún todavía es 7.
    vi.setSystemTime(new Date("2026-09-08T03:00:00.000Z"));

    await getTodayView("user-1", "ASESOR");

    const due = whereDeTareas().dueDate as { lte: Date };
    expect(due.lte.toISOString()).toBe("2026-09-08T04:59:59.999Z");

    vi.useRealTimers();
  });
});
