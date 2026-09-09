import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #753, la mitad de arriba: el reloj de la bandeja de rescate se cumple cuando el
// lead consigue DUEÑO. `sla.orphan.test.ts` prueba las dos funciones por separado; esto
// prueba que el reparto llama a la que corresponde en el momento que corresponde, que es
// donde el defecto vivía de verdad: hoy el ORPHAN lo cerraba cualquier mensaje saliente y
// NADA lo cerraba al asignar.

const systemConfigFindUnique = vi.fn();
const systemConfigUpsert = vi.fn();
const userFindMany = vi.fn();
const contactFindUnique = vi.fn();
const routingRuleFindMany = vi.fn();
const notificationCreate = vi.fn();
const notificationCreateMany = vi.fn();
const contactUpdate = vi.fn();
const createSlaTimer = vi.fn();
const cumplirOrphan = vi.fn();
const emitEvent = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    systemConfig: {
      findUnique: (...a: unknown[]) => systemConfigFindUnique(...a),
      upsert: (...a: unknown[]) => systemConfigUpsert(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    routingRule: { findMany: (...a: unknown[]) => routingRuleFindMany(...a) },
    notification: {
      create: (...a: unknown[]) => notificationCreate(...a),
      createMany: (...a: unknown[]) => notificationCreateMany(...a),
    },
  },
}));
vi.mock("./sla", () => ({
  createSlaTimer: (...a: unknown[]) => createSlaTimer(...a),
  cumplirOrphan: (...a: unknown[]) => cumplirOrphan(...a),
}));
vi.mock("./events", () => ({ emitEvent: (...a: unknown[]) => emitEvent(...a) }));
vi.mock("@/lib/teams/territory", () => ({ resolveTerritoryForContact: vi.fn(async () => null) }));
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_o: unknown, fn: (tx: unknown) => unknown) =>
    fn({ contact: { update: (...a: unknown[]) => contactUpdate(...a) } }),
}));

import { autoRouteLead } from "./routing";

function contact(extra: Record<string, unknown> = {}) {
  return {
    id: "c1", deletedAt: null, assignedToId: null,
    firstName: "Ana", lastName: "P", leadSource: "WHATSAPP",
    score: 0, adAttribution: null, targetPlaza: "TULUM", ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  systemConfigFindUnique.mockResolvedValue(null);
  systemConfigUpsert.mockResolvedValue({});
  contactUpdate.mockResolvedValue({});
  notificationCreate.mockResolvedValue({});
  notificationCreateMany.mockResolvedValue({});
  createSlaTimer.mockResolvedValue({});
  cumplirOrphan.mockResolvedValue(1);
  routingRuleFindMany.mockResolvedValue([
    { id: "r1", strategy: "ROUND_ROBIN", conditions: {}, targets: {}, priority: 1 },
  ]);
});

describe("autoRouteLead — el ORPHAN se cumple al conseguir dueño (#753)", () => {
  it("asignar cumple el reloj del Pond", async () => {
    contactFindUnique.mockResolvedValue(contact());
    userFindMany.mockResolvedValue([{ id: "asesor-1" }]);

    expect(await autoRouteLead("c1")).toBe("asesor-1");
    expect(cumplirOrphan).toHaveBeenCalledWith("c1");
  });

  it("NO asignar no lo cumple: el lead se va al Pond y su reloj sigue corriendo", async () => {
    // Este es el par que da sentido al anterior. Si `cumplirOrphan` se llamara también
    // aquí, el reloj se cerraría justo en el caso que existe para vigilar.
    contactFindUnique.mockResolvedValue(contact());
    userFindMany.mockResolvedValue([]); // sin candidatos ruteables

    expect(await autoRouteLead("c1")).toBeNull();
    expect(cumplirOrphan).not.toHaveBeenCalled();
    expect(createSlaTimer).toHaveBeenCalledWith("c1", "ORPHAN");
  });

  it("un fallo al cumplirlo no tumba la asignación ni el aviso al asesor", async () => {
    // La dirección del fallo es deliberada: si esto no corre, el temporizador se queda
    // RUNNING y acaba venciendo —una falsa alarma, que se mira—. Dejarlo caer perdería la
    // notificación y el evento `lead.assigned`, que el asesor sí espera.
    contactFindUnique.mockResolvedValue(contact());
    userFindMany.mockResolvedValue([{ id: "asesor-1" }]);
    cumplirOrphan.mockRejectedValue(new Error("db down"));
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await autoRouteLead("c1")).toBe("asesor-1");
    expect(notificationCreate).toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalled();
    // Y no es un `.catch` mudo: la lección de la #687.
    expect(errores).toHaveBeenCalled();

    errores.mockRestore();
  });

  it("el contacto se asigna primero y el reloj se cierra después, no al revés", async () => {
    // Si se cumpliera antes del update y el update fallara, quedaría un ORPHAN cumplido
    // sobre un lead todavía sin dueño: exactamente la fila que hay hoy en producción.
    contactFindUnique.mockResolvedValue(contact());
    userFindMany.mockResolvedValue([{ id: "asesor-1" }]);
    const orden: string[] = [];
    contactUpdate.mockImplementation(async () => { orden.push("asignar"); return {}; });
    cumplirOrphan.mockImplementation(async () => { orden.push("cumplir"); return 1; });

    await autoRouteLead("c1");

    expect(orden).toEqual(["asignar", "cumplir"]);
  });
});
