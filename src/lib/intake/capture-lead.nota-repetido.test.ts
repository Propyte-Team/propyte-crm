import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindFirst = vi.fn();
const activityCreate = vi.fn();
const userFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: { findUnique: async () => null },
    contact: {
      findFirst: (...a: unknown[]) => contactFindFirst(...a),
      create: vi.fn(async () => ({ id: "c-new", assignedToId: null })),
      update: vi.fn(async () => ({})),
    },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    adAttribution: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
  },
}));
vi.mock("@/lib/workflows/routing", () => ({ autoRouteLead: vi.fn(async () => "u1") }));
vi.mock("@/lib/workflows/events", () => ({ emitEvent: vi.fn() }));

import { captureLead } from "./capture-lead";

/**
 * #663 — la nota de «lead repetido» se escribía con `userId: existing.assignedToId ??
 * existing.id`: un id de Contact en una FK a `users`. La base lo rechaza con P2003 y el
 * `.catch(() => {})` se comía el rechazo, así que la nota no aparecía y nadie se enteraba.
 *
 * Y solo fallaba para los contactos SIN asesor asignado — que hoy son justo los que entran
 * por DM y comentario, la única vía viva. O sea que el registro de «este ya había venido
 * antes» se perdía precisamente donde más falta hace para no llamar dos veces a la misma
 * persona.
 */

const repetido = (assignedToId: string | null) => {
  contactFindFirst.mockResolvedValue({ id: "c-1", assignedToId });
  return captureLead({ source: "INSTAGRAM", firstName: "Ana", instagramId: "IG-1" });
};

beforeEach(() => {
  vi.clearAllMocks();
  activityCreate.mockResolvedValue({});
  userFindFirst.mockResolvedValue({ id: "u-admin" });
});

describe("captureLead — la nota de lead repetido", () => {
  it("con asesor asignado, la nota se atribuye al asesor", async () => {
    await repetido("u-asesor");

    expect(activityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u-asesor" }) }),
    );
  });

  /**
   * 🚨 El caso roto. `userId` tiene que ser un usuario de verdad, nunca el contacto: el id
   * del contacto en esa columna es lo que reventaba la FK.
   */
  it("sin asesor, se atribuye a un ADMIN activo y NUNCA al contacto", async () => {
    await repetido(null);

    const data = activityCreate.mock.calls[0][0].data as { userId: string; contactId: string };
    expect(data.userId).toBe("u-admin");
    expect(data.userId).not.toBe(data.contactId);
    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "ADMIN", isActive: true } }),
    );
  });

  // Sin nadie a quien atribuirla, se omite y se dice. Inventar un id costaría la FK.
  it("sin asesor ni ADMIN activo, no se escribe la nota y queda avisado", async () => {
    userFindFirst.mockResolvedValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await repetido(null);

    expect(activityCreate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(r.contactId).toBe("c-1"); // la captura del lead no se pierde por esto
    warn.mockRestore();
  });

  /**
   * El catch sigue existiendo —la nota no vale perder la captura— pero deja rastro. Un
   * catch mudo convierte cualquier regresión futura en «la nota no sale desde no sé cuándo».
   */
  it("si la escritura falla, la captura sigue y el fallo se registra", async () => {
    activityCreate.mockRejectedValue(new Error("P2003"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await repetido("u-asesor");

    expect(r).toMatchObject({ contactId: "c-1", isNew: false });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
