import { describe, it, expect, vi, beforeEach } from "vitest";

// Ruteo por plaza (targetPlaza del contacto) + Pond (#678): un lead que ninguna
// regla pudo asignar arranca reloj ORPHAN y avisa a la gerencia, no se pierde.
const systemConfigFindUnique = vi.fn();
const systemConfigUpsert = vi.fn();
const userFindMany = vi.fn();
const contactFindUnique = vi.fn();
const routingRuleFindMany = vi.fn();
const notificationCreate = vi.fn();
const notificationCreateMany = vi.fn();
const contactUpdate = vi.fn();
const createSlaTimer = vi.fn();
const emitEvent = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    systemConfig: { findUnique: (...a: unknown[]) => systemConfigFindUnique(...a), upsert: (...a: unknown[]) => systemConfigUpsert(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    routingRule: { findMany: (...a: unknown[]) => routingRuleFindMany(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a), createMany: (...a: unknown[]) => notificationCreateMany(...a) },
  },
}));
vi.mock("./sla", () => ({ createSlaTimer: (...a: unknown[]) => createSlaTimer(...a) }));
vi.mock("./events", () => ({ emitEvent: (...a: unknown[]) => emitEvent(...a) }));
vi.mock("@/lib/teams/territory", () => ({ resolveTerritoryForContact: vi.fn(async () => null) }));
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_o: unknown, fn: (tx: unknown) => unknown) => fn({ contact: { update: (...a: unknown[]) => contactUpdate(...a) } }),
}));

import { autoRouteLead } from "./routing";

function contact(extra: Record<string, unknown>) {
  return { id: "c1", deletedAt: null, assignedToId: null, firstName: "Ana", lastName: "P", leadSource: "WHATSAPP", score: 0, adAttribution: null, targetPlaza: null, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  systemConfigFindUnique.mockResolvedValue(null);
  systemConfigUpsert.mockResolvedValue({});
  contactUpdate.mockResolvedValue({});
  notificationCreate.mockResolvedValue({});
  notificationCreateMany.mockResolvedValue({});
  createSlaTimer.mockResolvedValue({});
  routingRuleFindMany.mockResolvedValue([{ strategy: "ROUND_ROBIN", conditions: {}, targets: {}, priority: 1 }]);
});

describe("autoRouteLead — ruteo por plaza", () => {
  it("filtra candidatos por la plaza del lead (targetPlaza)", async () => {
    contactFindUnique.mockResolvedValue(contact({ targetPlaza: "TULUM" }));
    userFindMany.mockResolvedValue([{ id: "asesor-tulum" }]);
    const r = await autoRouteLead("c1");
    expect(r).toBe("asesor-tulum");
    expect(userFindMany.mock.calls[0][0].where.plaza).toBe("TULUM");
  });

  it("sin targetPlaza no agrega filtro de plaza", async () => {
    contactFindUnique.mockResolvedValue(contact({ targetPlaza: null }));
    userFindMany.mockResolvedValue([{ id: "u1" }]);
    await autoRouteLead("c1");
    expect(userFindMany.mock.calls[0][0].where.plaza).toBeUndefined();
  });
});

describe("autoRouteLead — Pond (#678)", () => {
  it("sin candidato: crea ORPHAN, notifica a gerencia de la plaza y emite lead.orphaned; devuelve null", async () => {
    contactFindUnique.mockResolvedValue(contact({ targetPlaza: "MERIDA" }));
    userFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "gerente-mid" }]);
    const r = await autoRouteLead("c1");
    expect(r).toBeNull();
    expect(createSlaTimer).toHaveBeenCalledWith("c1", "ORPHAN");
    expect(notificationCreateMany).toHaveBeenCalledTimes(1);
    expect(notificationCreateMany.mock.calls[0][0].data[0].userId).toBe("gerente-mid");
    expect(emitEvent).toHaveBeenCalledWith("lead.orphaned", "contact", "c1", expect.objectContaining({ plaza: "MERIDA" }));
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("Pond sin gerencia en la plaza: reintenta con toda la gerencia", async () => {
    contactFindUnique.mockResolvedValue(contact({ targetPlaza: "MERIDA" }));
    userFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "dir" }]);
    const r = await autoRouteLead("c1");
    expect(r).toBeNull();
    expect(userFindMany).toHaveBeenCalledTimes(3);
    expect(notificationCreateMany.mock.calls[0][0].data[0].userId).toBe("dir");
  });
});
