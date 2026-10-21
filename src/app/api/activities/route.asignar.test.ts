import { describe, it, expect, vi, beforeEach } from "vitest";

// #915: una tarea se le puede asignar a otra persona según el rol de quien la crea, y la persona
// asignada recibe «Se te ha asignado una tarea». Antes el POST forzaba userId = sesión.

const session: { user: { id: string; role: string; plaza: string | null; name: string } } = {
  user: { id: "tl-1", role: "TEAM_LEADER", plaza: "PDC", name: "Laura TL" },
};
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const contactFindUnique = vi.fn();
const activityCreate = vi.fn();
const userFindUnique = vi.fn();
const notificationCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    deal: { findUnique: vi.fn() },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    conversation: { findFirst: vi.fn() },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
  },
}));

import { POST } from "./route";

const CONTACTO = "11111111-1111-4111-8111-111111111111";
const ASESOR_EQUIPO = "22222222-2222-4222-8222-222222222222";
const ASESOR_OTRO_EQUIPO = "33333333-3333-4333-8333-333333333333";
const ASESOR_TULUM = "44444444-4444-4444-8444-444444444444";
const NO_EXISTE = "55555555-5555-4555-8555-555555555555";

const USUARIOS: Record<string, object> = {
  [ASESOR_EQUIPO]: { id: ASESOR_EQUIPO, role: "ASESOR", plaza: "PDC", teamLeaderId: "tl-1", isActive: true, deletedAt: null, email: "pedro@propyte.com" },
  [ASESOR_OTRO_EQUIPO]: { id: ASESOR_OTRO_EQUIPO, role: "ASESOR_SR", plaza: "PDC", teamLeaderId: "tl-2", isActive: true, deletedAt: null, email: "sara@propyte.com" },
  [ASESOR_TULUM]: { id: ASESOR_TULUM, role: "ASESOR", plaza: "TULUM", teamLeaderId: null, isActive: true, deletedAt: null, email: "tulum@propyte.com" },
};

function req(body: unknown) {
  return new Request("http://localhost/api/activities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const TAREA = { contactId: CONTACTO, activityType: "TASK", subject: "Llamar para confirmar visita" };

beforeEach(() => {
  session.user = { id: "tl-1", role: "TEAM_LEADER", plaza: "PDC", name: "Laura TL" };
  [contactFindUnique, activityCreate, userFindUnique, notificationCreate].forEach((m) => m.mockReset());
  contactFindUnique.mockResolvedValue({ id: CONTACTO });
  userFindUnique.mockImplementation(async (args: { where: { id: string } }) => USUARIOS[args.where.id] ?? null);
  activityCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: "act-1",
    subject: args.data.subject,
    dueDate: args.data.dueDate ?? null,
    contact: { id: CONTACTO, firstName: "Ana", lastName: "López" },
  }));
  notificationCreate.mockResolvedValue({ id: "n1" });
});

describe("POST /api/activities — asignar a otra persona (#915)", () => {
  it("TEAM_LEADER → asesor de su equipo: la tarea es del asesor, el TL queda como creador, y se le avisa", async () => {
    const res = await POST(req({ ...TAREA, assigneeId: ASESOR_EQUIPO }));
    expect(res.status).toBe(201);
    const data = activityCreate.mock.calls[0][0].data;
    expect(data.userId).toBe(ASESOR_EQUIPO);
    expect(data.createdById).toBe("tl-1");
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(notificationCreate.mock.calls[0][0].data).toMatchObject({
      userId: ASESOR_EQUIPO,
      type: "task_assigned",
      title: "Se te ha asignado una tarea",
      link: "/agenda",
    });
    expect(notificationCreate.mock.calls[0][0].data.message).toContain("Llamar para confirmar visita");
    expect(notificationCreate.mock.calls[0][0].data.message).toContain("Te la asignó Laura TL");
  });

  it("TEAM_LEADER → asesor de OTRO equipo: 403 y no se crea nada", async () => {
    const res = await POST(req({ ...TAREA, assigneeId: ASESOR_OTRO_EQUIPO }));
    expect(res.status).toBe(403);
    expect(activityCreate).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("GERENTE → asesor de su plaza sí; de otra plaza, 403", async () => {
    session.user = { id: "ger-1", role: "GERENTE", plaza: "PDC", name: "Carlos" };
    expect((await POST(req({ ...TAREA, assigneeId: ASESOR_OTRO_EQUIPO }))).status).toBe(201);
    expect((await POST(req({ ...TAREA, assigneeId: ASESOR_TULUM }))).status).toBe(403);
  });

  it("DIRECTOR y ADMIN → cualquier asesor", async () => {
    for (const role of ["DIRECTOR", "ADMIN"]) {
      session.user = { id: `${role}-1`, role, plaza: "PDC", name: role };
      expect((await POST(req({ ...TAREA, assigneeId: ASESOR_TULUM }))).status).toBe(201);
    }
  });

  it("ASESOR → otro asesor: 403", async () => {
    session.user = { id: ASESOR_EQUIPO, role: "ASESOR", plaza: "PDC", name: "Pedro" };
    const res = await POST(req({ ...TAREA, assigneeId: ASESOR_OTRO_EQUIPO }));
    expect(res.status).toBe(403);
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it("un usuario que no existe: 400", async () => {
    const res = await POST(req({ ...TAREA, assigneeId: NO_EXISTE }));
    expect(res.status).toBe(400);
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it("sin assigneeId la tarea es de quien la crea, sin creador aparte y sin aviso (como siempre)", async () => {
    const res = await POST(req(TAREA));
    expect(res.status).toBe(201);
    const data = activityCreate.mock.calls[0][0].data;
    expect(data.userId).toBe("tl-1");
    expect(data).not.toHaveProperty("createdById");
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("asignarse a uno mismo (el selector manda el id propio) es lo mismo que no asignar", async () => {
    const YO = "66666666-6666-4666-8666-666666666666";
    session.user = { id: YO, role: "TEAM_LEADER", plaza: "PDC", name: "Laura TL" };
    const res = await POST(req({ ...TAREA, assigneeId: YO }));
    expect(res.status).toBe(201);
    expect(activityCreate.mock.calls[0][0].data.userId).toBe(YO);
    expect(activityCreate.mock.calls[0][0].data).not.toHaveProperty("createdById");
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});
