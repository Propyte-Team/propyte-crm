import { describe, it, expect, vi, beforeEach } from "vitest";

// Nota: agrupado en vi.hoisted() porque vi.mock("@/lib/db", factory) se
// hoistea por encima de TODO el código top-level del archivo. Sin esto, la
// factory intenta leer `userFindMany` antes de que exista ->
// "Cannot access 'userFindMany' before initialization".
const { userFindMany } = vi.hoisted(() => {
  return { userFindMany: vi.fn() };
});

vi.mock("@/lib/db", () => ({
  default: { user: { findMany: (...a: unknown[]) => userFindMany(...a) } },
}));
vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "actor-1", role: "DIRECTOR" } }),
}));

import { getUsers } from "./admin";

beforeEach(() => {
  userFindMany.mockReset().mockResolvedValue([]);
});

describe("getUsers", () => {
  it("por defecto esconde a los eliminados", async () => {
    await getUsers();
    expect(userFindMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
  });

  it("con includeDeleted trae a todos", async () => {
    await getUsers({ includeDeleted: true });
    expect(userFindMany.mock.calls[0][0].where).toEqual({});
  });

  it("selecciona status, deletedAt y los datos de suspensión", async () => {
    await getUsers();
    const { select } = userFindMany.mock.calls[0][0];
    expect(select.status).toBe(true);
    expect(select.deletedAt).toBe(true);
    expect(select.suspensionReason).toBe(true);
    expect(select.suspendedAt).toBe(true);
  });

  it("cuenta contactos vivos además de negocios, para ver quién tiene cartera", async () => {
    await getUsers();
    const { select } = userFindMany.mock.calls[0][0];
    expect(select._count.select.deals).toEqual({ where: { deletedAt: null } });
    expect(select._count.select.assignedContacts).toEqual({
      where: { deletedAt: null },
    });
  });
});
