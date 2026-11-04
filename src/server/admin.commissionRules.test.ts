import { describe, it, expect, vi, beforeEach } from "vitest";

// Mismo patrón que admin.deleteUser.test.ts: sesión y Prisma mockeados.
const session = { user: { id: "actor-1", role: "DIRECTOR" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => session }));

const ruleFindFirst = vi.fn();
const ruleFindUnique = vi.fn();
const ruleCreate = vi.fn();
const ruleUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    commissionRule: {
      findFirst: (...a: unknown[]) => ruleFindFirst(...a),
      findUnique: (...a: unknown[]) => ruleFindUnique(...a),
      create: (...a: unknown[]) => ruleCreate(...a),
      update: (...a: unknown[]) => ruleUpdate(...a),
    },
  },
}));

import { createCommissionRule, updateCommissionRule } from "./admin";

const CLAVE = { dealType: "NATIVA_CONTADO", leadSourceCategory: "PROPYTE_LEAD", role: "ASESOR_SR" };

beforeEach(() => {
  vi.clearAllMocks();
  session.user.role = "DIRECTOR";
});

describe("createCommissionRule", () => {
  it("rechaza una regla con la misma combinación y no escribe", async () => {
    ruleFindFirst.mockResolvedValue({ id: "r1", ...CLAVE, percentage: 2.5 });
    const res = await createCommissionRule({ ...CLAVE, percentage: 3 });
    expect(res).toMatchObject({ error: expect.stringMatching(/Ya existe una regla para Nativa Contado · Lead Propyte/) });
    expect(ruleCreate).not.toHaveBeenCalled();
  });

  it("crea cuando no hay otra igual", async () => {
    ruleFindFirst.mockResolvedValue(null);
    ruleCreate.mockResolvedValue({ id: "r2", ...CLAVE, percentage: 3, isActive: true });
    const res = await createCommissionRule({ ...CLAVE, percentage: 3 });
    expect(res).toMatchObject({ id: "r2" });
    expect(ruleFindFirst).toHaveBeenCalledWith({ where: CLAVE });
  });

  it("traduce el choque del índice único (carrera) al mismo error", async () => {
    ruleFindFirst.mockResolvedValue(null);
    ruleCreate.mockRejectedValue(Object.assign(new Error("Unique"), { code: "P2002" }));
    const res = await createCommissionRule({ ...CLAVE, percentage: 3 });
    expect(res).toMatchObject({ error: expect.stringMatching(/Ya existe una regla/) });
  });

  it("deja pasar otros errores de la base", async () => {
    ruleFindFirst.mockResolvedValue(null);
    ruleCreate.mockRejectedValue(new Error("conexión caída"));
    await expect(createCommissionRule({ ...CLAVE, percentage: 3 })).rejects.toThrow("conexión caída");
  });
});

describe("updateCommissionRule", () => {
  it("rechaza mover la regla a una combinación ya ocupada por otra", async () => {
    ruleFindUnique.mockResolvedValue({ id: "r1", ...CLAVE, percentage: 2 });
    ruleFindFirst.mockResolvedValue({ id: "r9", ...CLAVE, role: "ASESOR_JR", percentage: 1 });
    const res = await updateCommissionRule("r1", { role: "ASESOR_JR" });
    expect(res).toMatchObject({ error: expect.stringMatching(/Ya existe una regla/) });
    expect(ruleUpdate).not.toHaveBeenCalled();
    expect(ruleFindFirst).toHaveBeenCalledWith({
      where: { ...CLAVE, role: "ASESOR_JR", id: { not: "r1" } },
    });
  });

  it("permite cambiar solo el porcentaje (la clave efectiva excluye a la propia regla)", async () => {
    ruleFindUnique.mockResolvedValue({ id: "r1", ...CLAVE, percentage: 2 });
    ruleFindFirst.mockResolvedValue(null);
    ruleUpdate.mockResolvedValue({ id: "r1", ...CLAVE, percentage: 4 });
    const res = await updateCommissionRule("r1", { percentage: 4 });
    expect(res).toMatchObject({ percentage: 4 });
    expect(ruleFindFirst).toHaveBeenCalledWith({ where: { ...CLAVE, id: { not: "r1" } } });
  });
});
