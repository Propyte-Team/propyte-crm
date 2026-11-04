import { describe, it, expect, vi, beforeEach } from "vitest";

// Reglas de reparto que apuntan a un equipo (targets.teamId): candidatos = miembros activos
// del equipo, ruteables y no excluidos; el líder recibe aviso si no es quien recibe el lead.

const systemConfigFindUnique = vi.fn();
const queryRaw = vi.fn(async (..._a: unknown[]) => [{ n: 1 }]);
const userFindMany = vi.fn();
const userFindUnique = vi.fn();
const contactFindUnique = vi.fn();
const routingRuleFindMany = vi.fn();
const notificationCreate = vi.fn();
const contactUpdate = vi.fn();
const teamFindFirst = vi.fn();
const teamMemberFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    systemConfig: { findUnique: (...a: unknown[]) => systemConfigFindUnique(...a) },
    user: {
      findMany: (...a: unknown[]) => userFindMany(...a),
      findUnique: (...a: unknown[]) => userFindUnique(...a),
    },
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    routingRule: { findMany: (...a: unknown[]) => routingRuleFindMany(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
    team: { findFirst: (...a: unknown[]) => teamFindFirst(...a) },
    teamMember: { findMany: (...a: unknown[]) => teamMemberFindMany(...a) },
  },
}));

vi.mock("./sla", () => ({ createSlaTimer: vi.fn(), cumplirOrphan: vi.fn(async () => 0) }));
vi.mock("./events", () => ({ emitEvent: vi.fn() }));
vi.mock("@/lib/teams/territory", () => ({ resolveTerritoryForContact: vi.fn(async () => null) }));
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_opts: unknown, fn: (tx: unknown) => unknown) =>
    fn({ contact: { update: (...a: unknown[]) => contactUpdate(...a) } }),
}));

import { autoRouteLead } from "./routing";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";

function setup(rules: unknown[]) {
  systemConfigFindUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    where.key === "workflows.routing.excluded_user_ids" ? { value: ["qa-1"] } : null,
  );
  contactFindUnique.mockResolvedValue({
    id: "c1", deletedAt: null, assignedToId: null, firstName: "Lead", lastName: "Real",
    leadSource: "WHATSAPP", score: 0, adAttribution: null, targetPlaza: null,
  });
  routingRuleFindMany.mockResolvedValue(rules);
  contactUpdate.mockResolvedValue({});
  notificationCreate.mockResolvedValue({});
  userFindUnique.mockResolvedValue({ name: "Ana" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("autoRouteLead — regla por equipo", () => {
  it("asigna a un miembro activo del equipo (sin exigir plaza) con el gate anti-test", async () => {
    setup([{ id: "r1", strategy: "ROUND_ROBIN", conditions: {}, targets: { teamId: TEAM_ID }, priority: 1 }]);
    teamFindFirst.mockResolvedValue({ id: TEAM_ID, name: "Tulum Centro", leaderId: null });
    teamMemberFindMany.mockResolvedValue([{ userId: "u-a" }, { userId: "u-b" }]);

    const result = await autoRouteLead("c1");
    expect(result).toBe("u-a");

    const where = teamMemberFindMany.mock.calls[0][0].where;
    expect(where.teamId).toBe(TEAM_ID);
    expect(where.leftAt).toBeNull();
    expect(where.user.isActive).toBe(true);
    expect(where.user.NOT).toEqual({ email: { endsWith: ".local" } });
    expect(where.user.id).toEqual({ notIn: ["qa-1"] });
    // Sin líder: solo la notificación al asesor.
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });

  it("equipo sin miembros ruteables: pasa a la siguiente regla", async () => {
    setup([
      { id: "r1", strategy: "ROUND_ROBIN", conditions: {}, targets: { teamId: TEAM_ID }, priority: 1 },
      { id: "r2", strategy: "ROUND_ROBIN", conditions: {}, targets: { userIds: ["u-z"] }, priority: 2 },
    ]);
    teamFindFirst.mockResolvedValue({ id: TEAM_ID, name: "Tulum Centro", leaderId: "lider" });
    teamMemberFindMany.mockResolvedValue([]);
    userFindMany.mockResolvedValue([{ id: "u-z" }]);

    const result = await autoRouteLead("c1");
    expect(result).toBe("u-z");
    // La regla que asignó no era de equipo: no se avisa a ningún líder.
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(notificationCreate.mock.calls[0][0].data.userId).toBe("u-z");
  });

  it("equipo inexistente o inactivo no asigna a nadie por esa regla", async () => {
    setup([{ id: "r1", strategy: "ROUND_ROBIN", conditions: {}, targets: { teamId: TEAM_ID }, priority: 1 }]);
    teamFindFirst.mockResolvedValue(null);
    userFindMany.mockResolvedValue([{ id: "u-general" }]); // turno general (#918)

    const result = await autoRouteLead("c1");
    expect(teamMemberFindMany).not.toHaveBeenCalled();
    expect(result).toBe("u-general");
  });

  it("avisa al líder del equipo cuando el asignado es otra persona", async () => {
    setup([{ id: "r1", strategy: "ROUND_ROBIN", conditions: {}, targets: { teamId: TEAM_ID }, priority: 1 }]);
    teamFindFirst.mockResolvedValue({ id: TEAM_ID, name: "Tulum Centro", leaderId: "lider" });
    teamMemberFindMany.mockResolvedValue([{ userId: "u-a" }]);

    await autoRouteLead("c1");
    expect(notificationCreate).toHaveBeenCalledTimes(2);
    const aviso = notificationCreate.mock.calls[1][0].data;
    expect(aviso.userId).toBe("lider");
    expect(aviso.message).toBe("Lead nuevo en tu equipo: Lead Real → asignado a Ana");
  });

  it("no avisa al líder si él mismo recibe el lead", async () => {
    setup([{ id: "r1", strategy: "ROUND_ROBIN", conditions: {}, targets: { teamId: TEAM_ID }, priority: 1 }]);
    teamFindFirst.mockResolvedValue({ id: TEAM_ID, name: "Tulum Centro", leaderId: "u-a" });
    teamMemberFindMany.mockResolvedValue([{ userId: "u-a" }]);

    await autoRouteLead("c1");
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });

  it("si falla el aviso al líder, el lead queda asignado igual", async () => {
    setup([{ id: "r1", strategy: "ROUND_ROBIN", conditions: {}, targets: { teamId: TEAM_ID }, priority: 1 }]);
    teamFindFirst.mockResolvedValue({ id: TEAM_ID, name: "Tulum Centro", leaderId: "lider" });
    teamMemberFindMany.mockResolvedValue([{ userId: "u-a" }]);
    notificationCreate.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await autoRouteLead("c1")).toBe("u-a");
  });
});
