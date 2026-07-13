import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindFirst = vi.fn();
const contactFindMany = vi.fn();
const userFindMany = vi.fn();
const notificationFindFirst = vi.fn();
const notificationCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findFirst: (...a: unknown[]) => contactFindFirst(...a),
      findMany: (...a: unknown[]) => contactFindMany(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    notification: {
      findFirst: (...a: unknown[]) => notificationFindFirst(...a),
      create: (...a: unknown[]) => notificationCreate(...a),
    },
  },
}));

import { detectDuplicatesForContact } from "./duplicate-alert";

beforeEach(() => {
  [contactFindFirst, contactFindMany, userFindMany, notificationFindFirst, notificationCreate].forEach((m) => m.mockReset());
  notificationFindFirst.mockResolvedValue(null);
  notificationCreate.mockResolvedValue({});
});

const seed = { id: "c1", firstName: "Ana", lastName: "López", email: "ana@x.com", phone: "+529991112233", assignedToId: "u1" };

describe("detectDuplicatesForContact", () => {
  it("sin contacto (borrado/inexistente) → no hace nada", async () => {
    contactFindFirst.mockResolvedValue(null);
    await detectDuplicatesForContact("nope");
    expect(contactFindMany).not.toHaveBeenCalled();
  });

  it("contacto sin phone ni email → no busca matches", async () => {
    contactFindFirst.mockResolvedValue({ ...seed, phone: "", email: null });
    await detectDuplicatesForContact("c1");
    expect(contactFindMany).not.toHaveBeenCalled();
  });

  it("sin matches → no crea notificación", async () => {
    contactFindFirst.mockResolvedValue(seed);
    contactFindMany.mockResolvedValue([]);
    await detectDuplicatesForContact("c1");
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("excluye al propio contacto y a soft-deleted/merged de la búsqueda de matches", async () => {
    contactFindFirst.mockResolvedValue(seed);
    contactFindMany.mockResolvedValue([]);
    await detectDuplicatesForContact("c1");
    const where = contactFindMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ not: "c1" });
    expect(where.deletedAt).toBeNull();
    expect(where.mergedIntoId).toBeNull();
  });

  it("hay match por teléfono → crea notificación para assignedToId con link /duplicados?focus=<id>", async () => {
    contactFindFirst.mockResolvedValue(seed);
    contactFindMany.mockResolvedValue([{ id: "c2", firstName: "Ana", lastName: "L", email: null, phone: "+529991112233" }]);
    await detectDuplicatesForContact("c1");
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          type: "duplicate_detected",
          title: "Posible contacto duplicado",
          link: "/duplicados?focus=c1",
        }),
      })
    );
  });

  it("contacto sin assignedToId → notifica a todos los ADMIN activos (fallback)", async () => {
    contactFindFirst.mockResolvedValue({ ...seed, assignedToId: null });
    contactFindMany.mockResolvedValue([{ id: "c2", firstName: "Ana", lastName: "L", email: null, phone: "+529991112233" }]);
    userFindMany.mockResolvedValue([{ id: "admin1" }, { id: "admin2" }]);
    await detectDuplicatesForContact("c1");
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ role: "ADMIN", isActive: true }) })
    );
    expect(notificationCreate).toHaveBeenCalledTimes(2);
    expect(notificationCreate.mock.calls.map((c) => c[0].data.userId).sort()).toEqual(["admin1", "admin2"]);
  });

  it("sin assignedToId y sin admins activos → no crea notificación", async () => {
    contactFindFirst.mockResolvedValue({ ...seed, assignedToId: null });
    contactFindMany.mockResolvedValue([{ id: "c2", firstName: "Ana", lastName: "L", email: null, phone: "+529991112233" }]);
    userFindMany.mockResolvedValue([]);
    await detectDuplicatesForContact("c1");
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("anti-spam: ya existe notification duplicate_detected reciente con el mismo link+userId → no crea otra", async () => {
    contactFindFirst.mockResolvedValue(seed);
    contactFindMany.mockResolvedValue([{ id: "c2", firstName: "Ana", lastName: "L", email: null, phone: "+529991112233" }]);
    notificationFindFirst.mockResolvedValue({ id: "notif-existing" });
    await detectDuplicatesForContact("c1");
    expect(notificationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "u1", type: "duplicate_detected", link: "/duplicados?focus=c1" }),
      })
    );
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("anti-spam usa ventana de 24h (gte reciente) al consultar notificaciones previas", async () => {
    contactFindFirst.mockResolvedValue(seed);
    contactFindMany.mockResolvedValue([{ id: "c2", firstName: "Ana", lastName: "L", email: null, phone: "+529991112233" }]);
    await detectDuplicatesForContact("c1");
    const where = notificationFindFirst.mock.calls[0][0].where;
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });

  it("NUNCA hace auto-merge (no llama contact.update — el mock ni lo define)", async () => {
    // El mock de @/lib/db en este archivo no expone contact.update: si la
    // implementación intentara fusionar/mutar el contacto, esta llamada
    // lanzaría un TypeError en vez de resolver limpiamente.
    contactFindFirst.mockResolvedValue(seed);
    contactFindMany.mockResolvedValue([{ id: "c2", firstName: "Ana", lastName: "L", email: null, phone: "+529991112233" }]);
    await expect(detectDuplicatesForContact("c1")).resolves.toBeUndefined();
  });
});
