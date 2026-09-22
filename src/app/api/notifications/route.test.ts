import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * #770 (auditoría de PR #70) — GET /api/notifications
 *
 * El hallazgo: el PR #70 añadió una comprobación de `session.user.id` DESPUÉS de la
 * línea que ya lo usaba para construir `where`. Estas pruebas fijan el orden correcto
 * -la comprobación antes del uso- de la única forma que sirve: viendo qué pasa cuando
 * `session.user` existe pero `id` no, que es exactamente el caso que un guardia mal
 * ubicado no cubre.
 *
 * #794 — PATCH tenía el mismo problema (guardia sin fundir con `session.user.id`) y
 * nadie lo había probado; se agregan las mismas pruebas de paridad para PATCH y para
 * el nuevo DELETE (#793) para que no vuelva a pasar desapercibido.
 */

const session: { user: { id?: string; role?: string } | null } = {
  user: { id: "u1", role: "ASESOR" },
};
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const findMany = vi.fn();
const count = vi.fn();
const updateMany = vi.fn();
const deleteMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    notification: {
      findMany: (...a: unknown[]) => findMany(...a),
      count: (...a: unknown[]) => count(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
    },
  },
}));

import { GET, PATCH, DELETE } from "./route";

function req(query = "") {
  return new Request(`http://t/api/notifications${query}`) as never;
}

function reqWithBody(body: unknown) {
  return new Request("http://t/api/notifications", {
    method: "PATCH", // el handler que corre lo decide el import (GET/PATCH/DELETE), no esto
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  [findMany, count, updateMany, deleteMany].forEach((m) => m.mockReset());
  session.user = { id: "u1", role: "ASESOR" };
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
  updateMany.mockResolvedValue({ count: 0 });
  deleteMany.mockResolvedValue({ count: 0 });
});

describe("GET /api/notifications — autenticación", () => {
  it("sin sesión, 401 y no toca la base", async () => {
    session.user = null as never;
    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  /**
   * 🚨 El caso del hallazgo. `session.user` existe -así que el primer `if` de una
   * versión con dos guardias separados NO se dispara- pero `id` es undefined. Antes
   * del arreglo, `where.userId` quedaba en `undefined`, Prisma lo omitía del filtro, y
   * `findMany` SE LLEGABA A LLAMAR: la respuesta habría listado notificaciones de
   * cualquier usuario, no las de nadie en particular. La prueba correcta no es "sigue
   * dando 401" sino "la consulta ni se dispara".
   */
  it("con sesión pero sin id, 401 y la consulta NUNCA se ejecuta", async () => {
    session.user = { role: "ASESOR" }; // sin id

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it("con sesión completa, filtra por el id del usuario y nadie más", async () => {
    await GET(req());

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ userId: "u1" });
    expect(count.mock.calls[0][0].where).toMatchObject({ userId: "u1" });
  });
});

describe("GET /api/notifications — límite", () => {
  it("acepta `pageSize` como alias de `limit`", async () => {
    await GET(req("?pageSize=7"));
    expect(findMany.mock.calls[0][0].take).toBe(7);
  });

  it("`limit` gana si vienen los dos", async () => {
    await GET(req("?limit=5&pageSize=90"));
    expect(findMany.mock.calls[0][0].take).toBe(5);
  });

  it("se acota a 100 por arriba y a 1 por abajo", async () => {
    await GET(req("?limit=500"));
    expect(findMany.mock.calls[0][0].take).toBe(100);

    await GET(req("?limit=0"));
    expect(findMany.mock.calls[1][0].take).toBe(1);
  });
});

describe("PATCH /api/notifications — autenticación (#794)", () => {
  it("sin sesión, 401 y no toca la base", async () => {
    session.user = null as never;
    const res = await PATCH(reqWithBody({ markAll: true }));

    expect(res.status).toBe(401);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("con sesión pero sin id, 401 y updateMany NUNCA se ejecuta (antes del fix sí se llamaba, con userId undefined)", async () => {
    session.user = { role: "ASESOR" }; // sin id

    const res = await PATCH(reqWithBody({ markAll: true }));

    expect(res.status).toBe(401);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("con sesión completa y markAll, filtra por el id del usuario y nadie más", async () => {
    await PATCH(reqWithBody({ markAll: true }));

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ userId: "u1", isRead: false });
  });

  it("con notificationIds puntuales, el where también queda acotado al usuario", async () => {
    await PATCH(reqWithBody({ notificationIds: ["11111111-1111-1111-1111-111111111111"] }));

    expect(updateMany.mock.calls[0][0].where).toMatchObject({ userId: "u1" });
  });

  it("sin notificationIds ni markAll, 400", async () => {
    const res = await PATCH(reqWithBody({}));
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/notifications — autenticación (#793)", () => {
  it("sin sesión, 401 y no toca la base", async () => {
    session.user = null as never;
    const res = await DELETE(reqWithBody({ deleteAll: true }));

    expect(res.status).toBe(401);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("con sesión pero sin id, 401 y deleteMany NUNCA se ejecuta", async () => {
    session.user = { role: "ASESOR" }; // sin id

    const res = await DELETE(reqWithBody({ deleteAll: true }));

    expect(res.status).toBe(401);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("deleteAll: borra solo las notificaciones del usuario actual", async () => {
    deleteMany.mockResolvedValue({ count: 3 });
    const res = await DELETE(reqWithBody({ deleteAll: true }));
    const body = await res.json();

    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany.mock.calls[0][0].where).toEqual({ userId: "u1" });
    expect(body).toEqual({ message: "3 notificaciones eliminadas", deletedCount: 3 });
  });

  it("notificationIds puntuales: el where queda acotado a esos ids Y al usuario", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    await DELETE(reqWithBody({ notificationIds: [id] }));

    expect(deleteMany.mock.calls[0][0].where).toEqual({
      id: { in: [id] },
      userId: "u1",
    });
  });

  it("sin notificationIds ni deleteAll, 400 y no toca la base", async () => {
    const res = await DELETE(reqWithBody({}));
    expect(res.status).toBe(400);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("body inválido (ids que no son uuid), 400", async () => {
    const res = await DELETE(reqWithBody({ notificationIds: ["no-es-uuid"] }));
    expect(res.status).toBe(400);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
