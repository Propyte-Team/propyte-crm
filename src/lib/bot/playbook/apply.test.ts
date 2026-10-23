import { describe, it, expect, vi, beforeEach } from "vitest";

const setChangeSource = vi.fn();
vi.mock("@/lib/audit/change-context", () => ({
  setChangeSource: (...a: unknown[]) => setChangeSource(...a),
}));

import { resolveWrite, applyCapture } from "./apply";

describe("resolveWrite", () => {
  it("nativo permitido", () => {
    expect(resolveWrite({ field: "budgetMax", value: 3000000 })).toEqual({ kind: "native", column: "budgetMax", value: 3000000 });
  });

  it("custom", () => {
    expect(resolveWrite({ field: "custom.color", value: "azul" })).toEqual({ kind: "custom", key: "color", value: "azul" });
  });

  it("campo no permitido → skip", () => {
    expect(resolveWrite({ field: "isAdmin", value: true })).toEqual({ kind: "skip", field: "isAdmin" });
  });
});

// 2026-10-12: lo que captura el bot salía en la cronología como cambio de la cuenta técnica a
// la que está asignado el contacto (agentes@propyte.local) o de «cualquier ADMIN activo»
// (Audit Temp). El actor lo decide ahora el helper común, con la marca de la cuenta del hilo.
describe("applyCapture — a quién se atribuye lo capturado", () => {
  const AGENTES = "u-agentes"; // agentes@propyte.local: no pasa el filtro de persona

  function mkDb(assignedToId: string | null, personas: string[], opts: { adminPersona?: string | null; marcaDelHilo?: string | null } = {}) {
    const contactUpdate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const userFindFirst = vi.fn(async ({ where }: { where: { id?: string } }) => {
      if (where.id) return personas.includes(where.id) ? { id: where.id } : null;
      const admin = opts.adminPersona === undefined ? "u-admin" : opts.adminPersona;
      return admin ? { id: admin } : null;
    });
    const conversationFindFirst = vi.fn(async () =>
      opts.marcaDelHilo ? { connector: { brand: { marketingOwnerUserId: opts.marcaDelHilo } } } : null,
    );
    const db = {
      contact: { findUnique: vi.fn(async () => ({ id: "c1", assignedToId, custom: {}, budgetMax: null })) },
      user: { findFirst: userFindFirst },
      conversation: { findFirst: conversationFindFirst },
      $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ contact: { update: contactUpdate }, auditLog: { create: auditCreate } }),
    };
    return { db, contactUpdate, auditCreate, conversationFindFirst };
  }

  const escribir = (db: unknown) =>
    applyCapture(db as never, "c1", [{ field: "budgetMax", value: 3000000 }], { taskKey: "presupuesto", conversationId: "conv-1" });

  // Cuerpo de bloque: una flecha que devuelve el mock lo registra como limpieza (#808).
  beforeEach(() => {
    setChangeSource.mockReset();
  });

  it("asesor persona: se atribuye al asesor", async () => {
    const { db, auditCreate } = mkDb("u-ana", ["u-ana"]);
    await escribir(db);
    expect(setChangeSource).toHaveBeenCalledWith(expect.anything(), { source: "bot_playbook", actorId: "u-ana" });
    expect(auditCreate.mock.calls[0][0].data.userId).toBe("u-ana");
  });

  it("asesor técnico y hilo de una cuenta con marca: al responsable de marketing de la marca; el contacto no cambia de dueño", async () => {
    const { db, contactUpdate, auditCreate, conversationFindFirst } = mkDb(AGENTES, ["u-mkt"], { marcaDelHilo: "u-mkt" });
    await escribir(db);
    expect((conversationFindFirst.mock.calls[0] as unknown as [{ where: { id: string } }])[0].where.id).toBe("conv-1");
    expect(auditCreate.mock.calls[0][0].data.userId).toBe("u-mkt");
    expect(contactUpdate.mock.calls[0][0].data).not.toHaveProperty("assignedToId");
  });

  it("asesor técnico sin marca: al ADMIN persona más antiguo", async () => {
    const { db, auditCreate } = mkDb(AGENTES, []);
    await escribir(db);
    expect(auditCreate.mock.calls[0][0].data.userId).toBe("u-admin");
  });

  it("sin ninguna persona (solo cuentas técnicas): el dato se guarda igual, firmado como antes", async () => {
    const { db, auditCreate } = mkDb(AGENTES, [], { adminPersona: null });
    await escribir(db);
    expect(auditCreate.mock.calls[0][0].data.userId).toBe(AGENTES);
  });

  it("sin nadie a quien atribuirlo: no escribe (igual que antes, nunca con un id inventado)", async () => {
    const { db, contactUpdate } = mkDb(null, [], { adminPersona: null });
    await escribir(db);
    expect(contactUpdate).not.toHaveBeenCalled();
  });
});
