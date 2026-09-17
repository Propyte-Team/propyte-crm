import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * #770 (auditoría de PR #70) — GET /api/notifications
 *
 * El hallazgo: el PR #70 añadió una comprobación de `session.user.id` DESPUÉS de la
 * línea que ya lo usaba para construir `where`. Estas pruebas fijan el orden correcto
 * -la comprobación antes del uso- de la única forma que sirve: viendo qué pasa cuando
 * `session.user` existe pero `id` no, que es exactamente el caso que un guardia mal
 * ubicado no cubre.
 */

const session: { user: { id?: string; role?: string } | null } = {
  user: { id: "u1", role: "ASESOR" },
};
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const findMany = vi.fn();
const count = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    notification: {
      findMany: (...a: unknown[]) => findMany(...a),
      count: (...a: unknown[]) => count(...a),
      updateMany: vi.fn(),
    },
  },
}));

import { GET } from "./route";

function req(query = "") {
  return new Request(`http://t/api/notifications${query}`) as never;
}

beforeEach(() => {
  findMany.mockReset();
  count.mockReset();
  session.user = { id: "u1", role: "ASESOR" };
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
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
