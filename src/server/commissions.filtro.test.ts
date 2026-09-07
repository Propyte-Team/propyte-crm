import { describe, it, expect, vi, beforeEach } from "vitest";

// Auditoría 2026-09-03 #D-06 — `{ commissionStatus: { not: undefined } }` no filtra nada:
// Prisma descarta las claves con valor `undefined`, así que esa rama del OR quedaba como
// `{}` y la condición completa era siempre verdadera. La pantalla de comisiones listaba
// todos los deals de la empresa, incluidos los perdidos y los que están en NEW_LEAD.

const dealFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  default: { deal: { findMany: (...a: unknown[]) => dealFindMany(...a) } },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "user-1", role: "DIRECTOR", plaza: "PDC" } }),
}));

import { getCommissions } from "./commissions";

beforeEach(() => {
  dealFindMany.mockReset().mockResolvedValue([]);
});

describe("getCommissions — condición principal", () => {
  it("solo trae ganados o con comisión facturada/pagada", async () => {
    await getCommissions();

    const where = dealFindMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { stage: "WON" },
      { commissionStatus: { in: ["FACTURADA", "PAGADA"] } },
    ]);
  });

  it("ninguna rama del OR queda vacía, que es lo que anulaba el filtro", async () => {
    await getCommissions();

    const or = dealFindMany.mock.calls[0][0].where.OR as Record<string, unknown>[];
    for (const rama of or) {
      expect(Object.keys(rama).length).toBeGreaterThan(0);
      for (const valor of Object.values(rama)) {
        expect(valor).not.toBeUndefined();
        if (valor && typeof valor === "object") {
          expect(Object.values(valor).every((v) => v !== undefined)).toBe(true);
        }
      }
    }
  });

  it("respeta el filtro explícito por estado sin perder el alcance RBAC", async () => {
    await getCommissions({ status: "PAGADA" });

    const where = dealFindMany.mock.calls[0][0].where;
    expect(where.commissionStatus).toBe("PAGADA");
    expect(where.deletedAt).toBeNull();
  });
});
