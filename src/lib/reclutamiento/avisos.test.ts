import { describe, it, expect, vi, beforeEach } from "vitest";

const activityCreate = vi.fn();
const notifCreateMany = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    notification: { createMany: (...a: unknown[]) => notifCreateMany(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));
const emitEvent = vi.fn();
vi.mock("@/lib/workflows/events", () => ({ emitEvent: (...a: unknown[]) => emitEvent(...a) }));
const gerenciaDeLaPlaza = vi.fn();
vi.mock("@/lib/workflows/gerencia", () => ({ gerenciaDeLaPlaza: (...a: unknown[]) => gerenciaDeLaPlaza(...a) }));
vi.mock("@/lib/workflows/ruteables", () => ({ usuarioRuteableWhere: () => ({ isActive: true }) }));

import { responsablesDe, avisarResultado } from "./avisos";

beforeEach(() => {
  activityCreate.mockReset();
  notifCreateMany.mockReset();
  userFindMany.mockReset();
  emitEvent.mockReset();
  gerenciaDeLaPlaza.mockReset();
});

describe("responsablesDe", () => {
  it("usa la configuración de la plaza si existe", async () => {
    expect(await responsablesDe("PDC", { PDC: ["u1", "u2"] })).toEqual(["u1", "u2"]);
    expect(gerenciaDeLaPlaza).not.toHaveBeenCalled();
  });
  it("sin configuración: gerencia de la plaza", async () => {
    gerenciaDeLaPlaza.mockResolvedValue(["g1"]);
    expect(await responsablesDe("MERIDA", {})).toEqual(["g1"]);
  });
  it("sin gerencia: default configurado; sin default: ADMIN personas", async () => {
    gerenciaDeLaPlaza.mockResolvedValue([]);
    expect(await responsablesDe("MERIDA", { default: ["d1"] })).toEqual(["d1"]);
    userFindMany.mockResolvedValue([{ id: "a1" }]);
    expect(await responsablesDe(null, {})).toEqual(["a1"]);
    expect((userFindMany.mock.calls[0][0] as { where: { role: string } }).where.role).toBe("ADMIN");
  });
  it("ubicación fuera del CRM (FORANEO): default sin consultar gerencia", async () => {
    expect(await responsablesDe("FORANEO", { default: ["d1"] })).toEqual(["d1"]);
    expect(gerenciaDeLaPlaza).not.toHaveBeenCalled();
  });
});

describe("avisarResultado", () => {
  const base = {
    candidatoId: "c1",
    contactId: "k1",
    conversationId: "v1",
    nombre: "Ana López",
    plaza: "PDC" as const,
    puntaje: 72,
    responsables: ["u1", "u2"],
  };
  it("APTO: tarea al primer responsable, aviso a todos, evento", async () => {
    activityCreate.mockResolvedValue({ id: "t1" });
    await avisarResultado({ ...base, resultado: "APTO" });
    const t = (activityCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(t).toMatchObject({ userId: "u1", contactId: "k1", activityType: "TASK", status: "PENDIENTE" });
    expect(t.subject).toBe("Entrevistar candidato Ana López — PDC");
    expect(t.description).toMatch(/ · Ficha: \/reclutamiento$/);
    expect(t.dueDate).toBeInstanceOf(Date);
    const n = (notifCreateMany.mock.calls[0][0] as { data: { userId: string; link: string; type: string; message: string }[] }).data;
    expect(n.map((x) => x.userId)).toEqual(["u1", "u2"]);
    expect(n[0].link).toBe("/inbox?c=v1");
    expect(n[0].type).toBe("recruitment_apto");
    expect(n[0].message).toBe("Ana López (PDC) — 72/100 · Ficha: /reclutamiento");
    expect(emitEvent).toHaveBeenCalledWith("recruitment.apto", "contact", "k1", expect.objectContaining({ candidatoId: "c1", puntaje: 72 }));
  });
  it("REVISAR: aviso sin tarea", async () => {
    await avisarResultado({ ...base, resultado: "REVISAR" });
    expect(activityCreate).not.toHaveBeenCalled();
    expect(notifCreateMany).toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith("recruitment.revisar", "contact", "k1", expect.anything());
  });
  it("NO_APTO: solo evento", async () => {
    await avisarResultado({ ...base, resultado: "NO_APTO" });
    expect(activityCreate).not.toHaveBeenCalled();
    expect(notifCreateMany).not.toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith("recruitment.no_apto", "contact", "k1", expect.anything());
  });
  it("sin responsables no crea tarea ni aviso pero sí evento, y nunca lanza", async () => {
    await avisarResultado({ ...base, resultado: "APTO", responsables: [] });
    expect(activityCreate).not.toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalled();
  });
});
