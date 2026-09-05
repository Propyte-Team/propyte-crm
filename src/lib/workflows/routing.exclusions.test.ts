import { describe, it, expect, vi, beforeEach } from "vitest";

// AUD-20260710-09: el round-robin asignó un lead de WhatsApp REAL a un usuario QA recién
// creado solo por estar activo. Gate anti-test en el ruteo:
//   1) lista configurable SystemConfig "workflows.routing.excluded_user_ids"
//   2) convención de correos internos/QA: dominio que termina en ".local" jamás recibe leads
// Ambos filtros deben viajar en el WHERE de los queries de candidatos (rol y userIds).

const systemConfigFindUnique = vi.fn();
const systemConfigUpsert = vi.fn();
const userFindMany = vi.fn();
const contactFindUnique = vi.fn();
const routingRuleFindMany = vi.fn();
const notificationCreate = vi.fn();
const contactUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    systemConfig: {
      findUnique: (...a: unknown[]) => systemConfigFindUnique(...a),
      upsert: (...a: unknown[]) => systemConfigUpsert(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    routingRule: { findMany: (...a: unknown[]) => routingRuleFindMany(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
  },
}));

vi.mock("./sla", () => ({ createSlaTimer: vi.fn() }));
vi.mock("./events", () => ({ emitEvent: vi.fn() }));
vi.mock("@/lib/teams/territory", () => ({ resolveTerritoryForContact: vi.fn(async () => null) }));
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_opts: unknown, fn: (tx: unknown) => unknown) =>
    fn({ contact: { update: (...a: unknown[]) => contactUpdate(...a) } }),
}));

import { autoRouteLead } from "./routing";

const EXCLUDED_KEY = "workflows.routing.excluded_user_ids";

function setupBase(opts: { excluded?: unknown; targets?: unknown } = {}) {
  systemConfigFindUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
    if (where.key === EXCLUDED_KEY && opts.excluded !== undefined) {
      return { key: EXCLUDED_KEY, value: opts.excluded };
    }
    return null; // rr_pointer y demás llaves: sin estado previo
  });
  contactFindUnique.mockResolvedValue({
    id: "c1",
    deletedAt: null,
    assignedToId: null,
    firstName: "Lead",
    lastName: "Real",
    leadSource: "WHATSAPP",
    score: 0,
    adAttribution: null,
    // #729: con plaza, para que estos casos sigan ejercitando el query por rol. Sin ella
    // el lead cae al Pond y el gate anti-test —lo que este archivo mide— no se evalúa.
    targetPlaza: "PDC",
  });
  routingRuleFindMany.mockResolvedValue([
    { strategy: "ROUND_ROBIN", conditions: {}, targets: opts.targets ?? {}, priority: 1 },
  ]);
  userFindMany.mockResolvedValue([{ id: "u-real" }]);
  contactUpdate.mockResolvedValue({});
  notificationCreate.mockResolvedValue({});
  systemConfigUpsert.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("autoRouteLead — gate anti-test (AUD-20260710-09)", () => {
  it("excluye ids de la lista SystemConfig y correos .local en el query por roles", async () => {
    setupBase({ excluded: ["qa-user-1", "qa-user-2"] });
    const result = await autoRouteLead("c1");
    expect(result).toBe("u-real");

    const where = userFindMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ notIn: ["qa-user-1", "qa-user-2"] });
    expect(where.NOT).toEqual({ email: { endsWith: ".local" } });
    expect(where.isActive).toBe(true);
  });

  it("sin lista configurada: no filtra por id pero SÍ excluye correos .local", async () => {
    setupBase();
    await autoRouteLead("c1");

    const where = userFindMany.mock.calls[0][0].where;
    expect(where.id).toBeUndefined();
    expect(where.NOT).toEqual({ email: { endsWith: ".local" } });
  });

  it("también aplica el gate cuando la regla apunta a userIds explícitos", async () => {
    setupBase({ excluded: ["qa-user-1"], targets: { userIds: ["u-real", "qa-user-1"] } });
    await autoRouteLead("c1");

    const where = userFindMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: ["u-real", "qa-user-1"], notIn: ["qa-user-1"] });
    expect(where.NOT).toEqual({ email: { endsWith: ".local" } });
  });

  it("valores no-string en la lista de config se ignoran (defensivo)", async () => {
    setupBase({ excluded: ["qa-user-1", 42, null, { x: 1 }] });
    await autoRouteLead("c1");

    const where = userFindMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ notIn: ["qa-user-1"] });
  });
});
