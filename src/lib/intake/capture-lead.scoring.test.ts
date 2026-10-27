// Lead scoring §7 «Frescura»: captureLead calcula el score del alta ANTES de CAPI y del ruteo,
// que lo leen. Esta suite fija el orden, que CAPI recibe el score fresco con la bandera encendida
// y que un fallo del scoring no tira la captura.
import { describe, it, expect, vi, beforeEach } from "vitest";

const orden: string[] = [];
const findFirst = vi.fn();
const create = vi.fn();
const contactFindUnique = vi.fn();
const cargarConfigScoring = vi.fn();
const calcularYGuardar = vi.fn();
const recordConversionEvent = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: { findUnique: async () => null },
    contact: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
      findUnique: (...a: unknown[]) => contactFindUnique(...a),
      update: vi.fn(async () => ({})),
    },
    adAttribution: { findUnique: vi.fn(), create: vi.fn(async () => ({})) },
    activity: { create: vi.fn(async () => ({})) },
  },
}));
vi.mock("@/lib/workflows/routing", () => ({
  autoRouteLead: vi.fn(async () => {
    orden.push("ruteo");
    return "u1";
  }),
}));
vi.mock("@/lib/workflows/events", () => ({ emitEvent: vi.fn() }));
vi.mock("@/lib/capi/events", () => ({ recordConversionEvent: (...a: unknown[]) => recordConversionEvent(...a) }));
vi.mock("@/lib/scoring/recalcular", () => ({
  cargarConfigScoring: () => cargarConfigScoring(),
  calcularYGuardar: (...a: unknown[]) => calcularYGuardar(...a),
}));

// Sin Postgres: el candado entrega el mismo db simulado (ver capture-lead.attribution.test.ts).
vi.mock("@/lib/intake/intake-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intake/intake-lock")>();
  const { default: db } = await import("@/lib/db");
  return { ...actual, withIntakeLock: async (_key: string | null, fn: (d: unknown) => Promise<unknown>) => fn(db) };
});
vi.mock("@/lib/users/actor-sistema", () => ({
  resolveActorUserId: async ({ assignedToId }: { assignedToId?: string | null }) => assignedToId ?? null,
}));

import { captureLead } from "./capture-lead";

beforeEach(() => {
  orden.length = 0;
  [findFirst, create, contactFindUnique, cargarConfigScoring, calcularYGuardar, recordConversionEvent].forEach((m) => m.mockReset());
  findFirst.mockResolvedValue(null);
  create.mockResolvedValue({ id: "c-new", assignedToId: null, score: 0 });
  calcularYGuardar.mockImplementation(async () => {
    orden.push("scoring");
    return 1;
  });
  recordConversionEvent.mockImplementation(async () => {
    orden.push("capi");
  });
});

describe("captureLead — score al capturar (lead scoring §7)", () => {
  it("bandera encendida: calcula antes de CAPI y del ruteo, y CAPI recibe el score fresco", async () => {
    cargarConfigScoring.mockResolvedValue({ modelo: {}, activo: true });
    contactFindUnique.mockResolvedValue({ score: 42 });
    await captureLead({ source: "WEBSITE", firstName: "Ana", email: "ana@x.com" });
    expect(calcularYGuardar).toHaveBeenCalledWith(["c-new"], { modelo: {}, activo: true });
    expect(orden).toEqual(["scoring", "capi", "ruteo"]);
    expect(recordConversionEvent).toHaveBeenCalledWith("LEAD", expect.objectContaining({ score: 42 }));
  });

  it("bandera apagada (sombra): calcula pero no relee el contacto; CAPI ve el score de siempre", async () => {
    cargarConfigScoring.mockResolvedValue({ modelo: {}, activo: false });
    await captureLead({ source: "WEBSITE", firstName: "Bea", email: "bea@x.com" });
    expect(calcularYGuardar).toHaveBeenCalled();
    expect(contactFindUnique).not.toHaveBeenCalled();
    expect(recordConversionEvent).toHaveBeenCalledWith("LEAD", expect.objectContaining({ score: 0 }));
  });

  it("si el scoring truena, la captura sigue (CAPI y ruteo corren)", async () => {
    cargarConfigScoring.mockRejectedValue(new Error("tabla sin migrar"));
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await captureLead({ source: "WEBSITE", firstName: "Cy", email: "cy@x.com" });
    expect(r).toEqual({ contactId: "c-new", isNew: true, assignedToId: "u1" });
    expect(orden).toEqual(["capi", "ruteo"]);
    errores.mockRestore();
  });

  it("alta provisional: no calcula (no es lead todavía; el cron lo cubre)", async () => {
    cargarConfigScoring.mockResolvedValue({ modelo: {}, activo: true });
    await captureLead({ source: "INSTAGRAM", firstName: "Di", email: "di@x.com" }, { provisional: true });
    expect(calcularYGuardar).not.toHaveBeenCalled();
  });
});
