import { describe, it, expect, vi, beforeEach } from "vitest";

// Ruteo por plaza (targetPlaza del contacto) + Pond (#678): un lead que ninguna
// regla pudo asignar arranca reloj ORPHAN y avisa a la gerencia, no se pierde.
const systemConfigFindUnique = vi.fn();
const systemConfigUpsert = vi.fn();
// El turno del round-robin ahora es un INSERT ... ON CONFLICT atómico (auditoría
// 2026-09-10). `contadores` es el estado que en producción vive en system_config.
const queryRaw = vi.fn();
const contadores = new Map<string, number>();
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
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    systemConfig: { findUnique: (...a: unknown[]) => systemConfigFindUnique(...a), upsert: (...a: unknown[]) => systemConfigUpsert(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    routingRule: { findMany: (...a: unknown[]) => routingRuleFindMany(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a), createMany: (...a: unknown[]) => notificationCreateMany(...a) },
  },
}));
// #753: `cumplirOrphan` entra al doble porque routing.ts la llama al asignar. Aquí solo
// hace falta que exista; quién la cumple se prueba en routing.orphan-cumplido.test.ts.
vi.mock("./sla", () => ({
  createSlaTimer: (...a: unknown[]) => createSlaTimer(...a),
  cumplirOrphan: vi.fn(async () => 0),
}));
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
  contadores.clear();
  // Default: un contador que siempre devuelve 1 → primer candidato. Los tests que miden
  // equidad lo reemplazan por uno con memoria.
  queryRaw.mockResolvedValue([{ n: 1 }]);
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

  // #729: antes, un lead sin plaza no agregaba filtro y se le entregaba a CUALQUIER
  // asesor de cualquier plaza. La migración declara lo contrario: sin plaza, al Pond.
  it("sin plaza resoluble no se fuerza asesor: cae al Pond (#729)", async () => {
    contactFindUnique.mockResolvedValue(contact({ targetPlaza: null }));
    userFindMany.mockResolvedValue([{ id: "gerente" }]);
    const r = await autoRouteLead("c1");
    expect(r).toBeNull();
    expect(createSlaTimer).toHaveBeenCalledWith("c1", "ORPHAN");
    expect(contactUpdate).not.toHaveBeenCalled();
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

// #728: el turno del round-robin se guardaba en UNA clave global mientras los candidatos
// ya venían filtrados por plaza. Como las listas de dos plazas son disjuntas, el puntero
// nunca pertenecía a la lista en curso, indexOf devolvía -1 y el turno colapsaba siempre
// en el primer asesor de cada plaza. Este test alterna plazas y exige equidad.
describe("autoRouteLead — equidad del round-robin por plaza (#728)", () => {
  const POOL: Record<string, Array<{ id: string }>> = {
    PDC: [{ id: "pdc-1" }, { id: "pdc-2" }, { id: "pdc-3" }],
    TULUM: [{ id: "tul-1" }, { id: "tul-2" }],
  };

  it("con leads alternando plaza, cada asesor de cada plaza recibe al menos uno", async () => {
    // Contador con persistencia real: sin ella el turno nunca avanza y el test no
    // distinguiría el arreglo del defecto.
    //
    // Auditoría 2026-09-10: el turno pasó de findUnique+upsert a un INSERT ... ON CONFLICT
    // atómico (una sola sentencia, ver `roundRobinPick`), así que el doble es de
    // `$queryRaw` y no de `systemConfig`. Simula lo mismo que hace Postgres: incrementa el
    // contador de esa clave y devuelve el valor resultante.
    queryRaw.mockImplementation(async (...args: unknown[]) => {
      const key = args[1] as string;
      const n = (contadores.get(key) ?? 0) + 1;
      contadores.set(key, n);
      return [{ n }];
    });
    userFindMany.mockImplementation(async (args: unknown) => {
      const plaza = (args as { where: { plaza?: string } }).where.plaza;
      return plaza ? (POOL[plaza] ?? []) : [];
    });
    routingRuleFindMany.mockResolvedValue([
      { id: "rule-1", strategy: "ROUND_ROBIN", conditions: {}, targets: {}, priority: 1 },
    ]);

    const asignados: string[] = [];
    for (const plaza of ["PDC", "TULUM", "PDC", "TULUM", "PDC", "TULUM"]) {
      contactFindUnique.mockResolvedValue(contact({ targetPlaza: plaza }));
      asignados.push((await autoRouteLead("c1")) as string);
    }

    for (const asesor of [...POOL.PDC, ...POOL.TULUM]) {
      expect(asignados, `${asesor.id} nunca recibió un lead: ${asignados.join(", ")}`).toContain(asesor.id);
    }
  });
});

// Auditoría 2026-09-10: el turno era leer → calcular → escribir, sin nada en medio que
// impidiera que otro lead se colara. Dos leads simultáneos leían el MISMO puntero y los
// dos iban al MISMO asesor, dejando además sin turno al que le tocaba. Es reparto de
// leads, o sea reparto de comisión.
describe("autoRouteLead — el turno es atómico (auditoría 2026-09-10)", () => {
  it("🚨 tres leads SIMULTÁNEOS van a tres asesores distintos", async () => {
    // El doble de `$queryRaw` reproduce lo que garantiza Postgres con
    // `INSERT ... ON CONFLICT DO UPDATE`: la fila se bloquea, así que dos llamadas
    // concurrentes reciben números CONSECUTIVOS y distintos, nunca el mismo.
    //
    // El `await` de en medio es el que hacía fallar a la versión anterior: cedía el turno
    // del event loop justo entre la lectura y la escritura, que es exactamente la ventana
    // donde se colaba el segundo lead.
    queryRaw.mockImplementation(async (...args: unknown[]) => {
      const key = args[1] as string;
      const n = (contadores.get(key) ?? 0) + 1;
      contadores.set(key, n); // incremento y lectura, sin ventana entre medias
      await new Promise((r) => setTimeout(r, 0));
      return [{ n }];
    });
    userFindMany.mockResolvedValue([{ id: "pdc-1" }, { id: "pdc-2" }, { id: "pdc-3" }]);
    contactFindUnique.mockResolvedValue(contact({ targetPlaza: "PDC" }));
    routingRuleFindMany.mockResolvedValue([
      { id: "rule-1", strategy: "ROUND_ROBIN", conditions: {}, targets: {}, priority: 1 },
    ]);

    const asignados = await Promise.all([
      autoRouteLead("c1"),
      autoRouteLead("c1"),
      autoRouteLead("c1"),
    ]);

    expect(new Set(asignados).size, `se repitió un asesor: ${asignados.join(", ")}`).toBe(3);
  });

  it("si el contador falla, el lead se asigna igual en vez de caer al Pond", async () => {
    // Un fallo de la base al avanzar el turno desequilibra el reparto, pero NO debe
    // costar el lead: se cae al primer candidato, que es lo que hacía la versión anterior
    // cuando no había puntero previo.
    vi.spyOn(console, "error").mockImplementation(() => {});
    queryRaw.mockRejectedValue(new Error("la base se cayó"));
    userFindMany.mockResolvedValue([{ id: "pdc-1" }, { id: "pdc-2" }]);
    contactFindUnique.mockResolvedValue(contact({ targetPlaza: "PDC" }));

    const r = await autoRouteLead("c1");

    expect(r).toBe("pdc-1");
    expect(createSlaTimer).not.toHaveBeenCalledWith("c1", "ORPHAN");
  });
});
