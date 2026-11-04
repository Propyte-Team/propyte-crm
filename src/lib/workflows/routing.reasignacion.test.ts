import { describe, it, expect, vi, beforeEach } from "vitest";

// Opciones de `autoRouteLead` que usa la reasignación por falta de primer contacto:
// excluir asesores, no mandar al Pond, origen propio en la bitácora y reloj nuevo.

const systemConfigFindUnique = vi.fn();
const systemConfigUpsert = vi.fn();
const queryRaw = vi.fn(async (..._a: unknown[]) => [{ n: 1 }]);
const userFindMany = vi.fn();
const contactFindUnique = vi.fn();
const routingRuleFindMany = vi.fn();
const notificationCreate = vi.fn();
const contactUpdate = vi.fn();
const createSlaTimer = vi.fn();
const cancelarRelojesDeAtencion = vi.fn();
const withChangeSourceOpts = vi.fn();
const orden: string[] = [];

vi.mock("@/lib/db", () => ({
  default: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
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
vi.mock("./sla", () => ({
  createSlaTimer: (...a: unknown[]) => {
    orden.push(`createSlaTimer:${a[1]}`);
    return createSlaTimer(...a);
  },
  cumplirOrphan: vi.fn(async () => 0),
  cancelarRelojesDeAtencion: (...a: unknown[]) => {
    orden.push("cancelar");
    return cancelarRelojesDeAtencion(...a);
  },
}));
vi.mock("./events", () => ({ emitEvent: vi.fn() }));
vi.mock("@/lib/teams/territory", () => ({ resolveTerritoryForContact: vi.fn(async () => null) }));
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (opts: unknown, fn: (tx: unknown) => unknown) => {
    withChangeSourceOpts(opts);
    return fn({ contact: { update: (...a: unknown[]) => contactUpdate(...a) } });
  },
}));

import { autoRouteLead } from "./routing";

function setup(candidatos: Array<{ id: string }>) {
  systemConfigFindUnique.mockResolvedValue(null);
  contactFindUnique.mockResolvedValue({
    id: "c1",
    deletedAt: null,
    assignedToId: "asesor-a",
    firstName: "Ana",
    lastName: "López",
    leadSource: "META_ADS",
    score: 0,
    adAttribution: null,
    targetPlaza: "PDC",
  });
  routingRuleFindMany.mockResolvedValue([{ id: "r1", strategy: "ROUND_ROBIN", conditions: {}, targets: {}, priority: 1 }]);
  userFindMany.mockResolvedValue(candidatos);
  contactUpdate.mockResolvedValue({});
  notificationCreate.mockResolvedValue({});
  systemConfigUpsert.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
  orden.length = 0;
});

describe("autoRouteLead — opciones de la reasignación por primer contacto", () => {
  it("excluye a los asesores que pide el llamador, sumados a la lista de SystemConfig", async () => {
    setup([{ id: "asesor-b" }]);
    systemConfigFindUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === "workflows.routing.excluded_user_ids" ? { value: ["qa-1"] } : null,
    );
    const r = await autoRouteLead("c1", { excluirUserIds: ["asesor-a", "qa-1"] });
    expect(r).toBe("asesor-b");
    expect(userFindMany.mock.calls[0][0].where.id).toEqual({ notIn: ["qa-1", "asesor-a"] });
  });

  it("con `sinPond` y nadie disponible: devuelve null sin tocar el contacto ni abrir el ORPHAN", async () => {
    setup([]);
    const r = await autoRouteLead("c1", { excluirUserIds: ["asesor-a"], sinPond: true });
    expect(r).toBeNull();
    expect(contactUpdate).not.toHaveBeenCalled();
    expect(createSlaTimer).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("deja el origen pedido en la bitácora y cierra el reloj anterior ANTES de abrir el nuevo", async () => {
    setup([{ id: "asesor-b" }]);
    await autoRouteLead("c1", { source: "sla_reasignacion", reiniciarPrimerContacto: true, reason: "sin primer contacto" });
    expect(withChangeSourceOpts).toHaveBeenCalledWith({ source: "sla_reasignacion" });
    expect(cancelarRelojesDeAtencion).toHaveBeenCalledWith("c1");
    expect(orden).toEqual(["cancelar", "createSlaTimer:FIRST_TOUCH"]);
    expect(notificationCreate.mock.calls[0][0].data).toMatchObject({ userId: "asesor-b", title: "Lead re-asignado" });
  });

  it("sin las opciones nuevas se comporta como antes: origen `routing` y sin cancelar relojes", async () => {
    setup([{ id: "asesor-b" }]);
    await autoRouteLead("c1");
    expect(withChangeSourceOpts).toHaveBeenCalledWith({ source: "routing" });
    expect(cancelarRelojesDeAtencion).not.toHaveBeenCalled();
  });
});
