import { describe, it, expect, vi, beforeEach } from "vitest";
import { selectAgentProfile, applyAgentTone, composeObjective, agentPlaybookOf } from "./agent-profiles";

const findMany = vi.fn();
const db = { botAgentProfile: { findMany: (...a: unknown[]) => findMany(...a) } };

// Cuerpo de bloque: una flecha que devuelve el mock lo registra como limpieza (#808).
beforeEach(() => {
  findMany.mockReset();
});

describe("selectAgentProfile", () => {
  it("filtra activos con el tipo (has) y toma el de menor priority", async () => {
    findMany.mockResolvedValue([{ id: "p1", name: "Brokers", playbook: null }]);
    const r = await selectAgentProfile(db as never, "BROKER_EXTERNO");
    expect(r?.id).toBe("p1");
    const args = findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ isActive: true, deletedAt: null });
    // #938: también busca los retirados equivalentes (REFERIDOR → Broker).
    expect([...args.where.contactTypes.hasSome].sort()).toEqual(["BROKER_EXTERNO", "REFERIDOR"]);
    expect(args.orderBy).toEqual({ priority: "asc" });
    expect(args.take).toBe(1);
  });

  // #863: un contacto sin tipo lo sigue atendiendo el agente que antes le tocaba por el
  // default COMPRADOR — el bot no cambia de comportamiento por el cambio de default.
  // #938: COMPRADOR se juntó en LEAD_COMPRADOR; el perfil guardado todavía con COMPRADOR (antes
  // de la migración de datos) también cuenta.
  it("contacto sin tipo (null) → se busca el agente de Lead Comprador (o de los tipos viejos)", async () => {
    findMany.mockResolvedValue([{ id: "p-comp", name: "Compradores", playbook: null }]);
    const r = await selectAgentProfile(db as never, null);
    expect(r?.id).toBe("p-comp");
    expect([...findMany.mock.calls[0][0].where.contactTypes.hasSome].sort()).toEqual(
      ["COMPRADOR", "INVERSIONISTA", "LEAD", "LEAD_COMPRADOR"],
    );
  });

  it("#938: un Lead Vendedor busca solo su tipo", async () => {
    findMany.mockResolvedValue([]);
    await selectAgentProfile(db as never, "LEAD_VENDEDOR");
    expect(findMany.mock.calls[0][0].where.contactTypes).toEqual({ hasSome: ["LEAD_VENDEDOR"] });
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
