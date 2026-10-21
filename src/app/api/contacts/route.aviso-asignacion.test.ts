import { describe, it, expect, vi, beforeEach } from "vitest";

// #915: reasignar un contacto desde su ficha (PUT /api/contacts) le avisa al nuevo asesor
// «Se te ha asignado una conversación». Antes ese camino cambiaba el dueño sin ninguna
// notificación. Lo mismo al dar de alta un contacto a nombre de otro asesor.

const contactFindFirst = vi.fn();
const contactCreate = vi.fn();
const contactUpdate = vi.fn();
const userFindUnique = vi.fn();
const conversationFindFirst = vi.fn();
const notificationCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findFirst: (...a: unknown[]) => contactFindFirst(...a),
      create: (...a: unknown[]) => contactCreate(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    conversation: { findFirst: (...a: unknown[]) => conversationFindFirst(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

vi.mock("@/lib/metadata/core-fields", () => ({
  resolveCoreFieldAccess: async () => ({}),
  nonEditableKeys: () => new Set(),
}));

vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_opts: unknown, fn: (tx: unknown) => unknown) =>
    fn({ contact: { update: (...a: unknown[]) => contactUpdate(...a) } }),
}));

vi.mock("@/server/contacts", () => ({ getContactAccessInfo: vi.fn() }));

import { POST, PUT } from "./route";

const CONTACTO = "11111111-1111-4111-8111-111111111111";
const PEDRO = "22222222-2222-4222-8222-222222222222";
const SARA = "33333333-3333-4333-8333-333333333333";

const SESION = { user: { id: "ger-1", role: "GERENTE", plaza: "PDC", name: "Carlos Gerente" } };

function peticion(method: "POST" | "PUT", body: unknown) {
  const url = method === "PUT" ? `https://x/api/contacts?id=${CONTACTO}` : "https://x/api/contacts";
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  [contactFindFirst, contactCreate, contactUpdate, userFindUnique, conversationFindFirst, notificationCreate, getServerSession]
    .forEach((m) => m.mockReset());
  getServerSession.mockResolvedValue(SESION);
  // El contacto que se edita lo tiene Pedro.
  contactFindFirst.mockImplementation(async (args: { where: { id?: string } }) =>
    args.where.id === CONTACTO
      ? { id: CONTACTO, phone: "+5219991112233", whatsappUserId: null, assignedToId: PEDRO }
      : null,
  );
  contactUpdate.mockImplementation(async (args: { data: { assignedTo?: { connect?: { id: string } } } }) => ({
    id: CONTACTO,
    firstName: "Ana",
    lastName: "López",
    assignedToId: args.data.assignedTo?.connect?.id ?? PEDRO,
  }));
  contactCreate.mockImplementation(async (args: { data: { assignedToId: string | null } }) => ({
    id: "nuevo",
    firstName: "Ana",
    lastName: "López",
    assignedToId: args.data.assignedToId,
  }));
  userFindUnique.mockImplementation(async (args: { where: { id: string } }) => ({
    id: args.where.id,
    email: "persona@propyte.com",
    isActive: true,
    deletedAt: null,
  }));
  conversationFindFirst.mockResolvedValue({ id: "conv-7" });
  notificationCreate.mockResolvedValue({ id: "n1" });
});

describe("PUT /api/contacts — reasignar desde la ficha avisa (#915)", () => {
  it("cambiar el asesor de Pedro a Sara: a Sara le llega «Se te ha asignado una conversación»", async () => {
    const res = await PUT(peticion("PUT", { assignedToId: SARA }));
    expect(res.status).toBe(200);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(notificationCreate.mock.calls[0][0].data).toEqual({
      userId: SARA,
      type: "conversation_assigned",
      title: "Se te ha asignado una conversación",
      message: "Ana López · Te la asignó Carlos Gerente",
      link: "/inbox?c=conv-7",
    });
  });

  it("guardar la ficha sin cambiar el asesor no avisa", async () => {
    await PUT(peticion("PUT", { assignedToId: PEDRO, firstName: "Ana" }));
    await PUT(peticion("PUT", { firstName: "Ana María" }));
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("quitar el asesor no avisa a nadie", async () => {
    await PUT(peticion("PUT", { assignedToId: null }));
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("si el aviso falla, la reasignación se guarda igual (200)", async () => {
    notificationCreate.mockRejectedValue(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await PUT(peticion("PUT", { assignedToId: SARA }));
    expect(res.status).toBe(200);
    expect(contactUpdate).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("POST /api/contacts — alta a nombre de otro asesor avisa (#915)", () => {
  const ALTA = { firstName: "Ana", lastName: "López", leadSource: "WHATSAPP", phone: "+5219991112233" };

  it("el gerente da de alta y elige a Sara: a Sara le llega el aviso", async () => {
    const res = await POST(peticion("POST", { ...ALTA, assignedToId: SARA }));
    expect(res.status).toBe(201);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(notificationCreate.mock.calls[0][0].data.userId).toBe(SARA);
  });

  it("el asesor que captura su propio contacto no se avisa a sí mismo", async () => {
    getServerSession.mockResolvedValue({ user: { id: PEDRO, role: "ASESOR", plaza: "PDC", name: "Pedro" } });
    const res = await POST(peticion("POST", ALTA));
    expect(res.status).toBe(201);
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});
