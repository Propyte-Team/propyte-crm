// GET /api/admin/automation/fuentes: permisos (igual que /api/admin/automation) y forma.
import { describe, it, expect, vi, beforeEach } from "vitest";

const session: { user: { id: string; role: string } } = { user: { id: "u1", role: "ASESOR" } };
let hasSession = true;
vi.mock("@/lib/auth/session", () => ({
  getServerSession: () => Promise.resolve(hasSession ? session : null),
}));

const plantillas = vi.fn();
const cadencias = vi.fn();
const usuarios = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    userTemplate: { findMany: (...a: unknown[]) => plantillas(...a) },
    actionPlan: { findMany: (...a: unknown[]) => cadencias(...a) },
    user: { findMany: (...a: unknown[]) => usuarios(...a) },
  },
}));

import { GET } from "./route";

beforeEach(() => {
  for (const m of [plantillas, cadencias, usuarios]) m.mockReset();
  hasSession = true;
  session.user = { id: "u1", role: "ASESOR" };
  plantillas.mockResolvedValue([]);
  cadencias.mockResolvedValue([]);
  usuarios.mockResolvedValue([]);
});

describe("GET /api/admin/automation/fuentes", () => {
  it("sin sesión → 401 y no consulta la base", async () => {
    hasSession = false;
    expect((await GET()).status).toBe(401);
    expect(plantillas).not.toHaveBeenCalled();
  });

  it("cualquier sesión puede leer (mismos permisos que GET /api/admin/automation)", async () => {
    expect((await GET()).status).toBe(200);
  });

  it("devuelve plantillas, cadencias y usuarios con nombres en español", async () => {
    plantillas.mockResolvedValue([
      { id: "t1", name: "Primer contacto ES", channel: "WHATSAPP", language: "ES" },
      { id: "t2", name: "Presentación ES", channel: "EMAIL", language: "ES" },
    ]);
    cadencias.mockResolvedValue([{ id: "p1", name: "Seguimiento 7 días" }]);
    usuarios.mockResolvedValue([{ id: "a1", name: "Ana", role: "ASESOR" }]);
    const res = await GET();
    expect((await res.json()).data).toEqual({
      plantillas: [
        { id: "t1", nombre: "Primer contacto ES", canal: "WHATSAPP", idioma: "ES" },
        { id: "t2", nombre: "Presentación ES", canal: "EMAIL", idioma: "ES" },
      ],
      cadencias: [{ id: "p1", nombre: "Seguimiento 7 días" }],
      usuarios: [{ id: "a1", nombre: "Ana", rol: "ASESOR" }],
    });
  });

  it("plantillas: activas, sin borrar, solo WhatsApp/correo, globales o del propio usuario", async () => {
    await GET();
    expect(plantillas.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      isActive: true,
      channel: { in: ["WHATSAPP", "EMAIL"] },
      OR: [{ userId: null }, { userId: "u1" }],
    });
  });

  it("cadencias: solo activas y sin borrar", async () => {
    await GET();
    expect(cadencias.mock.calls[0][0].where).toEqual({ deletedAt: null, isActive: true });
  });

  it("usuarios: asesores ruteables + mando, activos y sin cuentas técnicas", async () => {
    await GET();
    const where = usuarios.mock.calls[0][0].where;
    expect(where.role.in).toEqual(["ASESOR", "ASESOR_SR", "ASESOR_JR", "GERENTE", "DIRECTOR", "ADMIN"]);
    expect(where).toMatchObject({ isActive: true, deletedAt: null, NOT: { email: { endsWith: ".local" } } });
  });
});
