import { describe, it, expect, vi, beforeEach } from "vitest";

const activityFindMany = vi.fn();
// Mutable para poder simular la ausencia de sesión — misma convención que
// src/app/api/admin/automation/plans/route.test.ts:3.
let session: { user: { id: string; role: string } } | null = null;

vi.mock("@/lib/db", () => ({
  default: {
    activity: { findMany: (...a: unknown[]) => activityFindMany(...a) },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: () => Promise.resolve(session),
}));

import { getMyAgenda } from "./agenda";

beforeEach(() => {
  activityFindMany.mockReset();
  activityFindMany.mockResolvedValue([]);
  session = { user: { id: "user-1", role: "ASESOR" } };
});

describe("getMyAgenda — scoping", () => {
  it("filtra siempre por el userId de la sesión", async () => {
    await getMyAgenda(new Date("2026-07-27T02:00:00Z"));
    expect(activityFindMany.mock.calls[0][0].where.userId).toBe("user-1");
  });

  it("un ADMIN tampoco ve pendientes ajenos: la agenda es personal", async () => {
    session = { user: { id: "admin-9", role: "ADMIN" } };
    await getMyAgenda(new Date("2026-07-27T02:00:00Z"));

    const where = activityFindMany.mock.calls[0][0].where;
    expect(where.userId).toBe("admin-9");
    // Sin ramas por rol: no hay `in`, no hay equipo.
    expect(typeof where.userId).toBe("string");
  });

  it("solo trae pendientes vivos", async () => {
    await getMyAgenda(new Date("2026-07-27T02:00:00Z"));
    const where = activityFindMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.status).toEqual({ in: ["PENDIENTE", "VENCIDA"] });
  });
});

describe("getMyAgenda — forma del resultado", () => {
  it("mapea la fila de Prisma a AgendaItem y la agrupa", async () => {
    activityFindMany.mockResolvedValue([
      {
        id: "act-1",
        subject: "Preparar propuesta",
        activityType: "TASK",
        status: "PENDIENTE",
        dueDate: new Date("2026-07-26T14:00:00Z"),
        contactId: null,
        contact: null,
      },
      {
        id: "act-2",
        subject: "Llamar a Ana",
        activityType: "CALL_TASK",
        status: "PENDIENTE",
        dueDate: new Date("2026-07-20T14:00:00Z"),
        contactId: "c-1",
        contact: { id: "c-1", firstName: "Ana", lastName: "Ruiz" },
      },
    ]);

    const result = await getMyAgenda(new Date("2026-07-27T02:00:00Z"));

    expect(result.total).toBe(2);
    expect(result.buckets.hoy[0]).toEqual({
      id: "act-1",
      subject: "Preparar propuesta",
      activityType: "TASK",
      status: "PENDIENTE",
      dueDate: "2026-07-26T14:00:00.000Z",
      contactId: null,
      contactName: null,
    });
    expect(result.buckets.vencidas[0].contactName).toBe("Ana Ruiz");
  });

  it("una actividad personal llega con contacto nulo, sin romper el mapeo", async () => {
    activityFindMany.mockResolvedValue([
      {
        id: "act-3",
        subject: "Renovar seguro del coche",
        activityType: "TASK",
        status: "PENDIENTE",
        dueDate: null,
        contactId: null,
        contact: null,
      },
    ]);

    const result = await getMyAgenda(new Date("2026-07-27T02:00:00Z"));
    expect(result.buckets.sin_fecha[0].contactName).toBeNull();
    expect(result.buckets.sin_fecha[0].dueDate).toBeNull();
  });

  it("lanza si no hay sesión", async () => {
    session = null;
    await expect(getMyAgenda(new Date("2026-07-27T02:00:00Z"))).rejects.toThrow("No autorizado");
  });
});
