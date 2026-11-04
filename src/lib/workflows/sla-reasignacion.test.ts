import { describe, it, expect, vi, beforeEach } from "vitest";

const systemConfigFindUnique = vi.fn();
const slaTimerFindMany = vi.fn();
const slaTimerFindFirst = vi.fn();
const contactFindUnique = vi.fn();
const rfcFindFirst = vi.fn();
const rfcFindMany = vi.fn();
const activityFindFirst = vi.fn();
const messageFindFirst = vi.fn();
const notificationCreateMany = vi.fn();
const autoRouteLead = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    systemConfig: { findUnique: (...a: unknown[]) => systemConfigFindUnique(...a) },
    slaTimer: {
      findMany: (...a: unknown[]) => slaTimerFindMany(...a),
      findFirst: (...a: unknown[]) => slaTimerFindFirst(...a),
    },
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    recordFieldChange: {
      findFirst: (...a: unknown[]) => rfcFindFirst(...a),
      findMany: (...a: unknown[]) => rfcFindMany(...a),
    },
    activity: { findFirst: (...a: unknown[]) => activityFindFirst(...a) },
    message: { findFirst: (...a: unknown[]) => messageFindFirst(...a) },
    notification: { createMany: (...a: unknown[]) => notificationCreateMany(...a) },
  },
}));
vi.mock("./routing", () => ({ autoRouteLead: (...a: unknown[]) => autoRouteLead(...a) }));

import { reasignarSinPrimerContacto } from "./sla-reasignacion";
import { CLAVE_REASIGNACION } from "./sla-reasignacion-model";

// Martes 3-nov-2026. Asignado a las 11:00 de Cancún (16:00 UTC); con 60 min hábiles vence a
// las 17:00 UTC. `AHORA` cae 10 minutos después del vencimiento.
const ASIGNADO = new Date("2026-11-03T16:00:00.000Z");
const AHORA = new Date("2026-11-03T17:10:00.000Z");

function configEncendida(extra: Record<string, unknown> = {}) {
  systemConfigFindUnique.mockResolvedValue({
    key: CLAVE_REASIGNACION,
    value: { activo: true, minutosHabiles: 60, maxReasignaciones: 2, activoDesde: "2026-11-01T00:00:00.000Z", ...extra },
    updatedAt: new Date("2026-11-01T00:00:00.000Z"),
  });
}

function leadSinContacto() {
  slaTimerFindMany.mockResolvedValue([
    { id: "t1", contactId: "c1", createdAt: ASIGNADO, policy: { businessHours: null } },
  ]);
  slaTimerFindFirst.mockResolvedValue(null);
  contactFindUnique.mockResolvedValue({
    deletedAt: null,
    firstName: "Ana",
    lastName: "López",
    leadSource: "META_ADS",
    assignedToId: "asesor-a",
    assignedTo: { id: "asesor-a", role: "ASESOR", teamLeaderId: "lider-1" },
  });
  rfcFindFirst.mockResolvedValue({ source: "routing", changedAt: new Date(ASIGNADO.getTime() - 500) });
  activityFindFirst.mockResolvedValue(null);
  messageFindFirst.mockResolvedValue(null);
  rfcFindMany.mockResolvedValue([]);
  autoRouteLead.mockResolvedValue("asesor-b");
  notificationCreateMany.mockResolvedValue({ count: 2 });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reasignarSinPrimerContacto", () => {
  it("apagada (sin fila): no busca relojes ni reasigna", async () => {
    systemConfigFindUnique.mockResolvedValue(null);
    const r = await reasignarSinPrimerContacto(50, AHORA);
    expect(r).toEqual({ revisados: 0, reasignados: 0, omitidos: {} });
    expect(slaTimerFindMany).not.toHaveBeenCalled();
    expect(autoRouteLead).not.toHaveBeenCalled();
  });

  it("vencido y sin contacto: pasa al siguiente asesor, sin Pond, con reloj nuevo y avisa al anterior y a su líder", async () => {
    configEncendida();
    leadSinContacto();

    const r = await reasignarSinPrimerContacto(50, AHORA);

    expect(r).toEqual({ revisados: 1, reasignados: 1, omitidos: {} });
    expect(autoRouteLead).toHaveBeenCalledWith("c1", {
      reason: "sin primer contacto en 1 h hábil",
      excluirUserIds: ["asesor-a"],
      sinPond: true,
      source: "sla_reasignacion",
      reiniciarPrimerContacto: true,
    });
    const avisos = notificationCreateMany.mock.calls[0][0].data;
    expect(avisos.map((a: { userId: string }) => a.userId)).toEqual(["asesor-a", "lider-1"]);
    expect(avisos[0]).toMatchObject({ type: "lead_reasignado_sla", link: "/contacts/c1" });
    expect(avisos[0].message).toContain("Ana López (META_ADS)");
  });

  it("solo busca relojes creados después de encenderla", async () => {
    configEncendida({ activoDesde: "2026-11-03T15:00:00.000Z" });
    leadSinContacto();
    await reasignarSinPrimerContacto(50, AHORA);
    expect(slaTimerFindMany.mock.calls[0][0].where.createdAt.gte.toISOString()).toBe("2026-11-03T15:00:00.000Z");
  });

  it("aún en plazo: no lo revisa", async () => {
    configEncendida();
    leadSinContacto();
    const r = await reasignarSinPrimerContacto(50, new Date("2026-11-03T16:50:00.000Z"));
    expect(r.revisados).toBe(0);
    expect(contactFindUnique).not.toHaveBeenCalled();
  });

  it("vencido hace más de la ventana (cron caído): no lo mueve", async () => {
    configEncendida();
    leadSinContacto();
    const r = await reasignarSinPrimerContacto(50, new Date("2026-11-03T20:00:00.000Z"));
    expect(r.revisados).toBe(0);
    expect(autoRouteLead).not.toHaveBeenCalled();
  });

  it("una llamada registrada a mano cuenta como primer contacto", async () => {
    configEncendida();
    leadSinContacto();
    activityFindFirst.mockResolvedValue({ id: "act-1" });
    const r = await reasignarSinPrimerContacto(50, AHORA);
    expect(r).toEqual({ revisados: 1, reasignados: 0, omitidos: { ya_contactado: 1 } });
    expect(autoRouteLead).not.toHaveBeenCalled();
    const where = activityFindFirst.mock.calls[0][0].where;
    expect(where.activityType.in).toContain("CALL_OUTBOUND");
    expect(where.createdAt).toEqual({ gte: ASIGNADO });
  });

  it("un mensaje saliente de un asesor cuenta como primer contacto; uno del bot no se busca", async () => {
    configEncendida();
    leadSinContacto();
    messageFindFirst.mockResolvedValue({ id: "m-1" });
    const r = await reasignarSinPrimerContacto(50, AHORA);
    expect(r.omitidos).toEqual({ ya_contactado: 1 });
    expect(messageFindFirst.mock.calls[0][0].where).toMatchObject({ direction: "OUTBOUND", sender: "ADVISOR", internalNote: false });
  });

  it("asignado a mano después del reparto: no se toca", async () => {
    configEncendida();
    leadSinContacto();
    rfcFindFirst.mockResolvedValue({ source: "inbox", changedAt: new Date(ASIGNADO.getTime() + 20 * 60_000) });
    const r = await reasignarSinPrimerContacto(50, AHORA);
    expect(r.omitidos).toEqual({ asignado_a_mano: 1 });
    expect(autoRouteLead).not.toHaveBeenCalled();
  });

  it("el dueño no es asesor (gerente, director): no se toca", async () => {
    configEncendida();
    leadSinContacto();
    contactFindUnique.mockResolvedValue({
      deletedAt: null, firstName: "Ana", lastName: "López", leadSource: "META_ADS",
      assignedToId: "gerente-1", assignedTo: { id: "gerente-1", role: "GERENTE", teamLeaderId: null },
    });
    const r = await reasignarSinPrimerContacto(50, AHORA);
    expect(r.omitidos).toEqual({ dueno_no_asesor: 1 });
  });

  it("excluye también a quienes ya lo perdieron por esta regla", async () => {
    configEncendida({ maxReasignaciones: 3 });
    leadSinContacto();
    rfcFindFirst.mockResolvedValue({ source: "sla_reasignacion", changedAt: new Date(ASIGNADO.getTime() - 500) });
    rfcFindMany.mockResolvedValue([{ oldValue: "asesor-z" }]);
    await reasignarSinPrimerContacto(50, AHORA);
    expect(autoRouteLead.mock.calls[0][1].excluirUserIds).toEqual(["asesor-a", "asesor-z"]);
  });

  it("con el tope alcanzado se queda donde está", async () => {
    configEncendida({ maxReasignaciones: 2 });
    leadSinContacto();
    rfcFindFirst.mockResolvedValue({ source: "sla_reasignacion", changedAt: new Date(ASIGNADO.getTime() - 500) });
    rfcFindMany.mockResolvedValue([{ oldValue: "asesor-y" }, { oldValue: "asesor-z" }]);
    const r = await reasignarSinPrimerContacto(50, AHORA);
    expect(r.omitidos).toEqual({ tope_de_reasignaciones: 1 });
    expect(autoRouteLead).not.toHaveBeenCalled();
  });

  it("sin otro asesor disponible: no avisa a nadie y lo reporta", async () => {
    configEncendida();
    leadSinContacto();
    autoRouteLead.mockResolvedValue(null);
    const r = await reasignarSinPrimerContacto(50, AHORA);
    expect(r.omitidos).toEqual({ sin_otro_asesor: 1 });
    expect(notificationCreateMany).not.toHaveBeenCalled();
  });

  it("un reloj que ya tiene uno más nuevo (otro dueño) se salta", async () => {
    configEncendida();
    leadSinContacto();
    slaTimerFindFirst.mockResolvedValue({ id: "t2" });
    const r = await reasignarSinPrimerContacto(50, AHORA);
    expect(r.omitidos).toEqual({ reloj_reemplazado: 1 });
    expect(contactFindUnique).not.toHaveBeenCalled();
  });

  it("si falla el aviso, la reasignación cuenta igual", async () => {
    configEncendida();
    leadSinContacto();
    notificationCreateMany.mockRejectedValue(new Error("tabla caída"));
    const r = await reasignarSinPrimerContacto(50, AHORA);
    expect(r.reasignados).toBe(1);
  });

  it("un lead que truena no detiene a los demás, y el tick lo reporta al final", async () => {
    configEncendida();
    leadSinContacto();
    slaTimerFindMany.mockResolvedValue([
      { id: "t1", contactId: "c1", createdAt: ASIGNADO, policy: null },
      { id: "t2", contactId: "c2", createdAt: ASIGNADO, policy: null },
    ]);
    contactFindUnique.mockRejectedValueOnce(new Error("boom"));
    await expect(reasignarSinPrimerContacto(50, AHORA)).rejects.toThrow(/1 con error/);
    expect(autoRouteLead).toHaveBeenCalledTimes(1);
    expect(autoRouteLead.mock.calls[0][0]).toBe("c2");
  });
});
