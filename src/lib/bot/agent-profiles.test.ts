import { describe, it, expect, vi, beforeEach } from "vitest";
import { selectAgentProfile } from "./agent-profiles";

const findMany = vi.fn();
const db = { botAgentProfile: { findMany: (...a: unknown[]) => findMany(...a) } };

beforeEach(() => findMany.mockReset());

describe("selectAgentProfile", () => {
  it("filtra activos con el tipo (has) y toma el de menor priority", async () => {
    findMany.mockResolvedValue([{ id: "p1", name: "Brokers", playbook: null }]);
    const r = await selectAgentProfile(db as never, "BROKER_EXTERNO");
    expect(r?.id).toBe("p1");
    const args = findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ isActive: true, deletedAt: null, contactTypes: { has: "BROKER_EXTERNO" } });
    expect(args.orderBy).toEqual({ priority: "asc" });
    expect(args.take).toBe(1);
  });

  it("sin perfil para el tipo → null; error de BD → null (nunca lanza)", async () => {
    findMany.mockResolvedValue([]);
    expect(await selectAgentProfile(db as never, "EMPLEO")).toBeNull();
    findMany.mockImplementation(() => { throw new Error("db"); });
    expect(await selectAgentProfile(db as never, "EMPLEO")).toBeNull();
  });

  it("playbook soft-borrado del perfil → se anula (fallback al global)", async () => {
    findMany.mockResolvedValue([
      { id: "p1", name: "X", playbook: { id: "pb1", deletedAt: new Date(), tasks: [] } },
    ]);
    const r = await selectAgentProfile(db as never, "EMPLEO");
    expect(r?.playbook).toBeNull();
  });
});
