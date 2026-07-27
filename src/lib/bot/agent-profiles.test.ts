import { describe, it, expect, vi, beforeEach } from "vitest";
import { selectAgentProfile, applyAgentTone, composeObjective, agentPlaybookOf } from "./agent-profiles";

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
    const dbBroken = { botAgentProfile: { findMany: async () => { throw new Error("db"); } } };
    expect(await selectAgentProfile(dbBroken as never, "EMPLEO")).toBeNull();
  });

  it("playbook soft-borrado del perfil → se anula (fallback al global)", async () => {
    findMany.mockResolvedValue([
      { id: "p1", name: "X", playbook: { id: "pb1", deletedAt: new Date(), tasks: [] } },
    ]);
    const r = await selectAgentProfile(db as never, "EMPLEO");
    expect(r?.playbook).toBeNull();
  });
});

describe("applyAgentTone", () => {
  const config = { tonePreset: "PROFESIONAL_CALIDO", model: "claude-sonnet-5" };

  it("perfil null → devuelve config sin cambios (misma referencia)", () => {
    expect(applyAgentTone(config, null)).toBe(config);
  });

  it("perfil sin tonePreset → devuelve config sin cambios", () => {
    expect(applyAgentTone(config, { tonePreset: null } as never)).toBe(config);
  });

  it("perfil con tonePreset → override en una copia (no muta el original)", () => {
    const r = applyAgentTone(config, { tonePreset: "EJECUTIVO_SOBRIO" } as never);
    expect(r).toEqual({ ...config, tonePreset: "EJECUTIVO_SOBRIO" });
    expect(r).not.toBe(config);
    expect(config.tonePreset).toBe("PROFESIONAL_CALIDO");
  });
});

describe("composeObjective", () => {
  it("identity y baseObjective presentes → unidos con doble salto de línea", () => {
    expect(composeObjective("IDENTIDAD", "OBJ")).toBe("IDENTIDAD\n\nOBJ");
  });

  it("solo identity → identity sola", () => {
    expect(composeObjective("IDENTIDAD", undefined)).toBe("IDENTIDAD");
  });

  it("solo baseObjective → baseObjective solo", () => {
    expect(composeObjective(null, "OBJ")).toBe("OBJ");
  });

  it("ninguno → undefined", () => {
    expect(composeObjective(null, undefined)).toBeUndefined();
    expect(composeObjective(undefined, "")).toBeUndefined();
  });
});

describe("agentPlaybookOf", () => {
  it("perfil null → null", () => {
    expect(agentPlaybookOf(null)).toBeNull();
  });

  it("perfil sin playbook → null", () => {
    expect(agentPlaybookOf({ playbook: null } as never)).toBeNull();
  });

  it("perfil con playbook sin tareas → null", () => {
    expect(agentPlaybookOf({ playbook: { id: "pb1", tasks: [] } } as never)).toBeNull();
  });

  it("perfil con playbook con >=1 tarea → el playbook", () => {
    const playbook = { id: "pb1", tasks: [{ id: "t1" }] };
    expect(agentPlaybookOf({ playbook } as never)).toBe(playbook);
  });
});
