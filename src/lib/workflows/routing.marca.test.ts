import { describe, it, expect, vi, beforeEach } from "vitest";

// #748 (2026-10-14): el reparto con marca. Los leads de Yaxnáh Caucel nacen con la plaza de
// la marca (MERIDA), y MERIDA no tiene asesores: los 6 contactos vivos de Yaxnáh sin dueño
// cayeron al Pond con `sin_candidatos_ruteables`. Una marca no predeterminada tiene su propio
// responsable (brands.marketingOwnerUserId): si el reparto no encuentra asesor para un lead
// de esa marca, el lead es suyo en vez de quedarse huérfano. La marca predeterminada sigue
// yendo al Pond como siempre.

const queryRaw = vi.fn();
const systemConfigFindUnique = vi.fn();
const userFindMany = vi.fn();
const userFindFirst = vi.fn();
const contactFindUnique = vi.fn();
const routingRuleFindMany = vi.fn();
const notificationCreate = vi.fn();
const notificationCreateMany = vi.fn();
const contactUpdate = vi.fn();
const createSlaTimer = vi.fn();
const emitEvent = vi.fn();
const cambios: Array<{ source: string }> = [];

vi.mock("@/lib/db", () => ({
  default: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    systemConfig: { findUnique: (...a: unknown[]) => systemConfigFindUnique(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a), findFirst: (...a: unknown[]) => userFindFirst(...a) },
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    routingRule: { findMany: (...a: unknown[]) => routingRuleFindMany(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a), createMany: (...a: unknown[]) => notificationCreateMany(...a) },
  },
}));
vi.mock("./sla", () => ({
  createSlaTimer: (...a: unknown[]) => createSlaTimer(...a),
  cumplirOrphan: vi.fn(async () => 0),
}));
vi.mock("./events", () => ({ emitEvent: (...a: unknown[]) => emitEvent(...a) }));
vi.mock("@/lib/teams/territory", () => ({ resolveTerritoryForContact: vi.fn(async () => null) }));
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (o: { source: string }, fn: (tx: unknown) => unknown) => {
    cambios.push(o);
    return fn({ contact: { update: (...a: unknown[]) => contactUpdate(o.source, ...a) } });
  },
}));
const resolveBrandForConnector = vi.fn();
vi.mock("@/lib/brands/resolve", () => ({
  resolveBrandForConnector: (...a: unknown[]) => resolveBrandForConnector(...a),
}));

import { autoRouteLead } from "./routing";

const LUIS = "u-luis";
const YAX = { id: "b-yax", name: "Yaxnáh Caucel", isDefault: false, defaultPlaza: "MERIDA", marketingOwnerUserId: LUIS, deletedAt: null };

function contact(extra: Record<string, unknown> = {}) {
  return {
    id: "c1", deletedAt: null, assignedToId: null, firstName: "Ana", lastName: "P", leadSource: "MESSENGER",
    score: 0, adAttribution: null, targetPlaza: "MERIDA", ...extra,
  };
}

/** Asesores por plaza (consulta con `role: { in: ROLES_RUTEABLES }` y `plaza`) y gerencia (mando). */
function asesores(porPlaza: Record<string, string[]>, gerencia: string[] = ["dir-mid"]) {
  userFindMany.mockImplementation(async ({ where }: { where: { role?: { in?: string[] }; plaza?: string } }) => {
    const roles = where.role?.in ?? [];
    if (roles.includes("GERENTE")) return gerencia.map((id) => ({ id }));
    return (where.plaza ? porPlaza[where.plaza] ?? [] : []).map((id) => ({ id }));
  });
}
/** Personas activas y no técnicas: findFirst({ where: { id } }) solo encuentra a estas. */
function personas(ids: string[]) {
  userFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => (ids.includes(where.id) ? { id: where.id } : null));
}

beforeEach(() => {
  vi.clearAllMocks();
  cambios.length = 0;
  queryRaw.mockResolvedValue([{ n: 1 }]);
  systemConfigFindUnique.mockResolvedValue(null);
  contactUpdate.mockResolvedValue({});
  notificationCreate.mockResolvedValue({});
  notificationCreateMany.mockResolvedValue({});
  createSlaTimer.mockResolvedValue(true);
  routingRuleFindMany.mockResolvedValue([{ id: "rr", strategy: "ROUND_ROBIN", conditions: {}, targets: {}, priority: 1 }]);
  resolveBrandForConnector.mockResolvedValue({ kind: "brand", brand: YAX });
  contactFindUnique.mockResolvedValue(contact());
  personas([LUIS]);
});

describe("autoRouteLead — responsable de la marca cuando no hay asesor", () => {
  it("lead de Yaxnáh sin asesores en MERIDA → se le asigna al responsable de la marca, con traza", async () => {
    asesores({ MERIDA: [] });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const r = await autoRouteLead("c1", { reason: "intake MESSENGER", connectorId: "c-yax" });

    expect(r).toBe(LUIS);
    expect(resolveBrandForConnector).toHaveBeenCalledWith("c-yax");
    // La persona se valida con el criterio del reparto (activo, no borrado, no .local).
    expect(userFindFirst.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ id: LUIS, isActive: true, deletedAt: null, NOT: { email: { endsWith: ".local" } } }),
    );
    // La asignación queda en la cronología con su propio origen, distinto del reparto por reglas.
    expect(contactUpdate).toHaveBeenCalledWith(
      "routing_marca",
      expect.objectContaining({ where: { id: "c1" }, data: expect.objectContaining({ assignedToId: LUIS }) }),
    );
    expect(cambios.map((c) => c.source)).not.toContain("routing");
    // Sigue el camino normal de una asignación: reloj de primer toque, aviso y evento.
    expect(createSlaTimer).toHaveBeenCalledWith("c1", "FIRST_TOUCH");
    expect(createSlaTimer).not.toHaveBeenCalledWith("c1", "ORPHAN");
    expect(notificationCreateMany).not.toHaveBeenCalled(); // no hay Pond
    const aviso = notificationCreate.mock.calls[0][0].data;
    expect(aviso.userId).toBe(LUIS);
    expect(aviso.message).toContain("responsable de la marca «Yaxnáh Caucel»");
    expect(aviso.message).toContain("MERIDA");
    expect(emitEvent).toHaveBeenCalledWith(
      "lead.assigned",
      "contact",
      "c1",
      expect.objectContaining({
        assigneeId: LUIS,
        via: "responsable_marca",
        brandId: "b-yax",
        motivoSinAsesor: "sin_candidatos_ruteables",
      }),
    );
    expect(info).toHaveBeenCalledWith(expect.stringContaining("responsable de la marca"));
    info.mockRestore();
  });

  it("con asesores en la plaza de la marca, ganan las reglas de siempre (no se consulta al responsable)", async () => {
    asesores({ MERIDA: ["asesor-mid"] });
    const r = await autoRouteLead("c1", { connectorId: "c-yax" });
    expect(r).toBe("asesor-mid");
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(contactUpdate).toHaveBeenCalledWith("routing", expect.anything());
    expect(emitEvent).toHaveBeenCalledWith("lead.assigned", "contact", "c1", expect.objectContaining({ via: "regla" }));
  });

  it("responsable inactivo o cuenta técnica → Pond, como cualquier lead sin candidato", async () => {
    asesores({ MERIDA: [] });
    personas([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await autoRouteLead("c1", { connectorId: "c-yax" });
    expect(r).toBeNull();
    expect(createSlaTimer).toHaveBeenCalledWith("c1", "ORPHAN");
    expect(contactUpdate).not.toHaveBeenCalledWith("routing_marca", expect.objectContaining({ data: expect.objectContaining({ assignedToId: expect.anything() }) }));
    warn.mockRestore();
  });

  it("responsable en la lista de excluidos del reparto → Pond, sin consultarlo", async () => {
    asesores({ MERIDA: [] });
    systemConfigFindUnique.mockResolvedValue({ value: [LUIS] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await autoRouteLead("c1", { connectorId: "c-yax" });
    expect(r).toBeNull();
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(createSlaTimer).toHaveBeenCalledWith("c1", "ORPHAN");
    warn.mockRestore();
  });

  it("marca sin responsable → Pond", async () => {
    resolveBrandForConnector.mockResolvedValue({ kind: "brand", brand: { ...YAX, marketingOwnerUserId: null } });
    asesores({ MERIDA: [] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await autoRouteLead("c1", { connectorId: "c-yax" })).toBeNull();
    expect(createSlaTimer).toHaveBeenCalledWith("c1", "ORPHAN");
    warn.mockRestore();
  });
});

describe("autoRouteLead — marca predeterminada: el Pond de siempre", () => {
  it("cuenta de Propyte sin asesor → Pond (ORPHAN + gerencia + lead.orphaned), sin responsable de marca", async () => {
    resolveBrandForConnector.mockResolvedValue({ kind: "default" });
    asesores({ MERIDA: [] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await autoRouteLead("c1", { connectorId: "c-propyte" });
    expect(r).toBeNull();
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(createSlaTimer).toHaveBeenCalledWith("c1", "ORPHAN");
    expect(notificationCreateMany).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith("lead.orphaned", "contact", "c1", expect.objectContaining({ motivo: "sin_candidatos_ruteables" }));
    warn.mockRestore();
  });

  it("marca no disponible (cuenta con marca borrada) se trata como sin marca", async () => {
    resolveBrandForConnector.mockResolvedValue({ kind: "unavailable", brandId: "b-x" });
    asesores({ MERIDA: [] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await autoRouteLead("c1", { connectorId: "c-x" })).toBeNull();
    expect(userFindFirst).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("sin cuenta (número general, o el llamador no la pasa) ni siquiera se resuelve la marca", async () => {
    asesores({ MERIDA: ["asesor-mid"] });
    await autoRouteLead("c1", { reason: "intake WEBSITE" });
    expect(resolveBrandForConnector).not.toHaveBeenCalled();
  });
});

describe("autoRouteLead — plaza predeterminada de la marca", () => {
  it("contacto de la marca SIN plaza → toma la de la marca (persistida) y se reparte con ella", async () => {
    contactFindUnique.mockResolvedValue(contact({ targetPlaza: null }));
    asesores({ MERIDA: ["asesor-mid"] });
    const r = await autoRouteLead("c1", { connectorId: "c-yax" });
    expect(r).toBe("asesor-mid");
    expect(contactUpdate).toHaveBeenCalledWith(
      "routing_marca",
      expect.objectContaining({ where: { id: "c1" }, data: { targetPlaza: "MERIDA" } }),
    );
    const consultaAsesores = userFindMany.mock.calls.find((c) => c[0].where.plaza)![0];
    expect(consultaAsesores.where.plaza).toBe("MERIDA");
  });

  it("contacto con plaza propia → no se toca", async () => {
    contactFindUnique.mockResolvedValue(contact({ targetPlaza: "PDC" }));
    asesores({ PDC: ["asesor-pdc"] });
    const r = await autoRouteLead("c1", { connectorId: "c-yax" });
    expect(r).toBe("asesor-pdc");
    expect(contactUpdate).not.toHaveBeenCalledWith("routing_marca", expect.objectContaining({ data: { targetPlaza: "MERIDA" } }));
  });

  it("marca predeterminada sin plaza → no inventa plaza (sigue siendo sin_plaza_resoluble)", async () => {
    resolveBrandForConnector.mockResolvedValue({ kind: "default" });
    contactFindUnique.mockResolvedValue(contact({ targetPlaza: null }));
    asesores({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await autoRouteLead("c1", { connectorId: "c-propyte" })).toBeNull();
    expect(contactUpdate).not.toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith("lead.orphaned", "contact", "c1", expect.objectContaining({ motivo: "sin_plaza_resoluble" }));
    warn.mockRestore();
  });
});

describe("Pond idempotente: un contacto que ya está en la bandeja de rescate no vuelve a avisar", () => {
  it("ya había un ORPHAN corriendo → ni aviso a la gerencia ni otro lead.orphaned", async () => {
    resolveBrandForConnector.mockResolvedValue({ kind: "default" });
    asesores({ MERIDA: [] });
    createSlaTimer.mockResolvedValue(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await autoRouteLead("c1", { connectorId: "c-propyte" })).toBeNull();
    expect(notificationCreateMany).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalledWith("lead.orphaned", expect.anything(), expect.anything(), expect.anything());
    expect(info).toHaveBeenCalledWith(expect.stringContaining("ya estaba en el Pond"));
    warn.mockRestore();
    info.mockRestore();
  });
});
