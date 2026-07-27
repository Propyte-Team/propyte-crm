import { describe, it, expect, vi, beforeEach } from "vitest";

const activityFindMany = vi.fn();
const activityCount = vi.fn();
// Mutable para poder simular la ausencia de sesión — misma convención que
// src/app/api/admin/automation/plans/route.test.ts:3.
let session: { user: { id: string; role: string } } | null = null;

vi.mock("@/lib/db", () => ({
  default: {
    activity: {
      findMany: (...a: unknown[]) => activityFindMany(...a),
      count: (...a: unknown[]) => activityCount(...a),
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: () => Promise.resolve(session),
}));

import { getMyAgenda, getMyRecentNotes } from "./agenda";

beforeEach(() => {
  activityFindMany.mockReset();
  activityFindMany.mockResolvedValue([]);
  activityCount.mockReset();
  activityCount.mockResolvedValue(0);
  session = { user: { id: "user-1", role: "ASESOR" } };
});

describe("getMyAgenda — scoping", () => {
  it("filtra siempre por el userId de la sesión", async () => {
    await getMyAgenda(new Date("2026-07-27T02:00:00Z"));
    // Query con fecha, query sin fecha y count: las tres deben llevar el scoping.
    expect(activityFindMany.mock.calls[0][0].where.userId).toBe("user-1");
    expect(activityFindMany.mock.calls[1][0].where.userId).toBe("user-1");
    expect(activityCount.mock.calls[0][0].where.userId).toBe("user-1");
  });

  it("un ADMIN tampoco ve pendientes ajenos: la agenda es personal", async () => {
    session = { user: { id: "admin-9", role: "ADMIN" } };
    await getMyAgenda(new Date("2026-07-27T02:00:00Z"));

    const where = activityFindMany.mock.calls[0][0].where;
    expect(where.userId).toBe("admin-9");
  });

  it("solo trae pendientes vivos", async () => {
    await getMyAgenda(new Date("2026-07-27T02:00:00Z"));
    const where = activityFindMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.status).toEqual({ in: ["PENDIENTE", "VENCIDA"] });
  });

  it("separa la lectura en una query con fecha y otra sin fecha", async () => {
    await getMyAgenda(new Date("2026-07-27T02:00:00Z"));

    const whereConFecha = activityFindMany.mock.calls[0][0].where;
    const whereSinFecha = activityFindMany.mock.calls[1][0].where;
    expect(whereConFecha.dueDate).toEqual({ not: null });
    expect(whereSinFecha.dueDate).toBeNull();
  });

  it("cada query usa su propio tope y orden — el bug que se está corrigiendo", async () => {
    await getMyAgenda(new Date("2026-07-27T02:00:00Z"));

    const conFechaCall = activityFindMany.mock.calls[0][0];
    const sinFechaCall = activityFindMany.mock.calls[1][0];

    expect(conFechaCall.take).toBe(200);
    expect(conFechaCall.orderBy).toEqual({ dueDate: "asc" });

    expect(sinFechaCall.take).toBe(50);
    expect(sinFechaCall.orderBy).toEqual({ createdAt: "desc" });
  });
});

describe("getMyAgenda — total y truncado", () => {
  it("total viene de prisma.activity.count, no de items.length", async () => {
    activityCount.mockResolvedValue(512);
    activityFindMany.mockResolvedValue([
      {
        id: "act-1",
        subject: "x",
        activityType: "TASK",
        status: "PENDIENTE",
        dueDate: null,
        contactId: null,
        contact: null,
      },
    ]);

    const result = await getMyAgenda(new Date("2026-07-27T02:00:00Z"));
    expect(result.total).toBe(512);
    expect(result.truncated).toBe(true);
  });

  it("truncated es false cuando ningún tope recorta nada", async () => {
    activityCount.mockResolvedValue(2);
    activityFindMany
      .mockResolvedValueOnce([
        {
          id: "act-1",
          subject: "x",
          activityType: "TASK",
          status: "PENDIENTE",
          dueDate: new Date("2026-07-27T14:00:00Z"),
          contactId: null,
          contact: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "act-2",
          subject: "y",
          activityType: "TASK",
          status: "PENDIENTE",
          dueDate: null,
          contactId: null,
          contact: null,
        },
      ]);

    const result = await getMyAgenda(new Date("2026-07-27T02:00:00Z"));
    expect(result.truncated).toBe(false);
  });

  it("el bucket sin_fecha no se vacía cuando la query con fecha agota su tope — la regresión que se previene", async () => {
    // Simula 200 pendientes CON fecha (agotan AGENDA_TAKE_CON_FECHA) más algunos sin fecha.
    const conFecha = Array.from({ length: 200 }, (_, i) => ({
      id: `act-con-${i}`,
      subject: "Con fecha",
      activityType: "TASK",
      status: "PENDIENTE",
      dueDate: new Date("2026-07-27T14:00:00Z"),
      contactId: null,
      contact: null,
    }));
    const sinFecha = [
      {
        id: "act-sin-1",
        subject: "Sin fecha",
        activityType: "TASK",
        status: "PENDIENTE",
        dueDate: null,
        contactId: null,
        contact: null,
      },
    ];
    activityFindMany.mockResolvedValueOnce(conFecha).mockResolvedValueOnce(sinFecha);
    activityCount.mockResolvedValue(201);

    const result = await getMyAgenda(new Date("2026-07-27T02:00:00Z"));
    expect(result.buckets.sin_fecha).toHaveLength(1);
    expect(result.buckets.sin_fecha[0].id).toBe("act-sin-1");
  });
});

describe("getMyAgenda — forma del resultado", () => {
  it("mapea la fila de Prisma a AgendaItem y la agrupa", async () => {
    activityFindMany
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([]);
    activityCount.mockResolvedValue(2);

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
    activityFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
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
    activityCount.mockResolvedValue(1);

    const result = await getMyAgenda(new Date("2026-07-27T02:00:00Z"));
    expect(result.buckets.sin_fecha[0].contactName).toBeNull();
    expect(result.buckets.sin_fecha[0].dueDate).toBeNull();
  });

  it("lanza si no hay sesión", async () => {
    session = null;
    await expect(getMyAgenda(new Date("2026-07-27T02:00:00Z"))).rejects.toThrow("No autorizado");
  });
});

describe("getMyRecentNotes", () => {
  it("trae solo NOTE del usuario de sesión", async () => {
    activityFindMany.mockResolvedValue([]);

    await getMyRecentNotes();

    const where = activityFindMany.mock.calls[0][0].where;
    expect(where.userId).toBe("user-1");
    expect(where.activityType).toBe("NOTE");
    expect(where.deletedAt).toBeNull();
  });

  it("mapea la nota con su fecha de creación en ISO", async () => {
    activityFindMany.mockResolvedValue([
      {
        id: "note-1",
        subject: "Idea para la campaña de Tulum",
        description: "Enfocar en preventa",
        createdAt: new Date("2026-07-26T14:00:00Z"),
        contactId: null,
        contact: null,
      },
    ]);

    const notes = await getMyRecentNotes();
    expect(notes).toEqual([
      {
        id: "note-1",
        subject: "Idea para la campaña de Tulum",
        description: "Enfocar en preventa",
        createdAt: "2026-07-26T14:00:00.000Z",
        contactId: null,
        contactName: null,
      },
    ]);
  });

  it("lanza si no hay sesión", async () => {
    session = null;
    await expect(getMyRecentNotes()).rejects.toThrow("No autorizado");
  });
});
