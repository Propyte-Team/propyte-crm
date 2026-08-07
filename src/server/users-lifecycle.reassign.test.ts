import { describe, it, expect, vi, beforeEach } from "vitest";

// Nota: agrupados en vi.hoisted() porque vi.mock("@/lib/db", factory) se
// hoistea por encima de TODO el código top-level del archivo (incluyendo un
// `const db = {...}` normal). Sin esto, la factory intenta leer `db` antes
// de que exista -> "Cannot access 'db' before initialization". Los vi.fn()
// sueltos sí se hoistean solos; el objeto que los envuelve, no.
const { moved, counted, auditCreate, userFindUnique, db } = vi.hoisted(() => {
  const moved: Record<string, number> = {};
  const counted: string[] = [];
  const auditCreate = vi.fn();
  const userFindUnique = vi.fn();

  function model(name: string) {
    return {
      count: vi.fn(async () => {
        counted.push(name);
        return 4;
      }),
      updateMany: vi.fn(async () => {
        moved[name] = (moved[name] ?? 0) + 1;
        return { count: 2 };
      }),
    };
  }

  const db = {
    contact: model("contact"),
    deal: model("deal"),
    conversation: model("conversation"),
    unit: model("unit"),
    walkIn: model("walkIn"),
    quote: model("quote"),
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  };

  return { moved, counted, auditCreate, userFindUnique, db };
});

vi.mock("@/lib/db", () => ({
  default: { ...db, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db) },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "actor-1", role: "GERENTE" } }),
}));

import { getUserAssetCounts, reassignUserAssets } from "./users-lifecycle";

beforeEach(() => {
  for (const k of Object.keys(moved)) delete moved[k];
  counted.length = 0;
  auditCreate.mockReset().mockResolvedValue({});
  userFindUnique.mockReset().mockResolvedValue({
    id: "u2", name: "Beto", isActive: true, deletedAt: null,
  });
});

describe("getUserAssetCounts", () => {
  it("devuelve un conteo por cada uno de los 6 scopes", async () => {
    const counts = await getUserAssetCounts("u1");

    expect(Object.keys(counts).sort()).toEqual(
      ["contacts", "conversations", "deals", "quotes", "units", "walkins"].sort(),
    );
    expect(counts.contacts).toBe(4);
  });
});

describe("reassignUserAssets", () => {
  it("mueve solo los scopes pedidos y ninguno más", async () => {
    await reassignUserAssets("u1", "u2", ["contacts", "deals"]);

    expect(Object.keys(moved).sort()).toEqual(["contact", "deal"]);
  });

  it("devuelve cuántas filas movió por scope", async () => {
    const result = await reassignUserAssets("u1", "u2", ["contacts"]);
    expect(result).toEqual({ contacts: 2 });
  });

  it("rechaza una lista de scopes vacía en vez de no hacer nada en silencio", async () => {
    await expect(reassignUserAssets("u1", "u2", [])).rejects.toThrow(/al menos un/i);
    expect(Object.keys(moved)).toEqual([]);
  });

  it("rechaza un scope que no existe", async () => {
    await expect(
      reassignUserAssets("u1", "u2", ["comisiones" as never]),
    ).rejects.toThrow();
    expect(Object.keys(moved)).toEqual([]);
  });

  it("rechaza si el destino es el mismo usuario", async () => {
    await expect(reassignUserAssets("u1", "u1", ["contacts"])).rejects.toThrow(
      /mismo usuario/,
    );
    expect(Object.keys(moved)).toEqual([]);
  });

  it("rechaza si el destino no está activo", async () => {
    userFindUnique.mockResolvedValue({
      id: "u2", name: "Beto", isActive: false, deletedAt: null,
    });
    await expect(reassignUserAssets("u1", "u2", ["contacts"])).rejects.toThrow(
      /activo/,
    );
    expect(Object.keys(moved)).toEqual([]);
  });

  it("guarda en AuditLog el origen y los conteos movidos", async () => {
    await reassignUserAssets("u1", "u2", ["contacts", "quotes"]);

    const { data } = auditCreate.mock.calls[0][0];
    expect(data.entity).toBe("User");
    expect(data.entityId).toBe("u2");
    expect(data.changes).toMatchObject({
      reassignedFrom: "u1",
      moved: { contacts: 2, quotes: 2 },
    });
  });
});
