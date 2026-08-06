import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const findUnique = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    conversation: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

// Dinámico dentro de la ruta (import() para media firmada) — sin bucket real en tests.
vi.mock("@/lib/storage/chat-media", () => ({
  signChatMediaUrls: vi.fn(async () => ({})),
  isStoragePath: (v: string) => !/^https?:\/\//i.test(v),
}));

import { GET } from "./route";

function req(qs = "") {
  return { nextUrl: new URL(`http://x/api/conversations/conv1${qs}`) } as never;
}

// Fixture con contact.assignedToId=null (hilo libre) por default; convWith() clona y
// mezcla overrides igual que en messages/route.test.ts.
const baseConversation = {
  id: "conv1",
  status: "HUMAN" as string,
  botEnabled: true,
  unreadCount: 3,
  lastMessageAt: null as string | null,
  aiSummary: null as string | null,
  channel: "WHATSAPP" as string,
  connectorId: "conn1",
  connector: { name: "WA Principal", config: null as unknown },
  contact: {
    id: "c1",
    firstName: "Ana",
    lastName: "Lopez",
    phone: "+521",
    email: "ana@x.com",
    temperature: "WARM",
    score: 10,
    preferredLanguage: "es",
    budgetMin: null as string | null,
    budgetMax: null as string | null,
    preferredZone: null as string | null,
    purchaseTimeline: null as string | null,
    whatsappOptOut: false,
    custom: null as unknown,
    assignedToId: null as string | null,
    // teamLeaderId viene del select (alcance del TEAM_LEADER) y NO debe salir en el JSON.
    assignedTo: null as { id: string; name: string; teamLeaderId: string | null } | null,
    deals: [] as unknown[],
  },
  controlledBy: null as { id: string; name: string } | null,
  messages: [] as unknown[],
};

function convWith(
  overrides: Partial<Omit<typeof baseConversation, "contact">> & {
    contact?: Partial<typeof baseConversation.contact>;
  } = {}
): typeof baseConversation {
  const { contact, ...rest } = overrides;
  return { ...baseConversation, ...rest, contact: { ...baseConversation.contact, ...contact } };
}

beforeEach(() => {
  [getServerSession, findUnique, update].forEach((m) => m.mockReset());
  update.mockResolvedValue({});
});

const ASESOR_SR = { user: { id: "u3", role: "ASESOR_SR" } };
const GERENTE = { user: { id: "boss1", role: "GERENTE" } };
const TEAM_LEADER = { user: { id: "tl1", role: "TEAM_LEADER" } };

describe("GET /api/conversations/[id] — alcance (espejo de la lista)", () => {
  it("401 sin sesión, sin tocar la BD", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET(req(), { params: { id: "conv1" } });
    expect(res.status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("GERENTE (vista completa) ve un hilo asignado a OTRO asesor → 200", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    findUnique.mockResolvedValue(convWith({ contact: { assignedToId: "otro-asesor" } }));
    const res = await GET(req(), { params: { id: "conv1" } });
    expect(res.status).toBe(200);
  });

  it("ASESOR_SR: hilo de OTRO → 404 y NO se marca leído", async () => {
    getServerSession.mockResolvedValue(ASESOR_SR);
    findUnique.mockResolvedValue(convWith({ contact: { assignedToId: "otro-asesor" } }));
    const res = await GET(req(), { params: { id: "conv1" } });
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("ASESOR_SR: hilo propio (assignedToId = su id) → 200 y SÍ se marca leído", async () => {
    getServerSession.mockResolvedValue(ASESOR_SR);
    findUnique.mockResolvedValue(convWith({ contact: { assignedToId: "u3" } }));
    const res = await GET(req(), { params: { id: "conv1" } });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ where: { id: "conv1" }, data: { unreadCount: 0 } });
  });

  it("ASESOR_SR: hilo SIN asignar → 200 (la cola libre es visible para todos)", async () => {
    getServerSession.mockResolvedValue(ASESOR_SR);
    findUnique.mockResolvedValue(convWith({ contact: { assignedToId: null } }));
    const res = await GET(req(), { params: { id: "conv1" } });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalled();
  });

  it("TEAM_LEADER: hilo de un asesor que NO le reporta → 404 (sigue sin vista completa)", async () => {
    getServerSession.mockResolvedValue(TEAM_LEADER);
    findUnique.mockResolvedValue(
      convWith({
        contact: {
          assignedToId: "otro-asesor",
          assignedTo: { id: "otro-asesor", name: "Ajeno", teamLeaderId: "otro-tl" },
        },
      })
    );
    const res = await GET(req(), { params: { id: "conv1" } });
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("TEAM_LEADER: hilo de un REPORTE DIRECTO → 200 (puede supervisar lo que repartió)", async () => {
    getServerSession.mockResolvedValue(TEAM_LEADER);
    findUnique.mockResolvedValue(
      convWith({
        contact: {
          assignedToId: "rep-1",
          assignedTo: { id: "rep-1", name: "Reporte", teamLeaderId: "tl1" },
        },
      })
    );
    const res = await GET(req(), { params: { id: "conv1" } });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalled();
  });

  it("teamLeaderId NO viaja en el JSON: assignedTo solo lleva id y name", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    findUnique.mockResolvedValue(
      convWith({
        contact: {
          assignedToId: "rep-1",
          assignedTo: { id: "rep-1", name: "Reporte", teamLeaderId: "tl1" },
        },
      })
    );
    const res = await GET(req(), { params: { id: "conv1" } });
    const body = await res.json();
    expect(body.data.contact.assignedTo).toEqual({ id: "rep-1", name: "Reporte" });
    expect(JSON.stringify(body)).not.toContain("teamLeaderId");
  });

  it("hilo inexistente → 404 (comportamiento previo intacto)", async () => {
    getServerSession.mockResolvedValue(ASESOR_SR);
    findUnique.mockResolvedValue(null);
    const res = await GET(req(), { params: { id: "conv1" } });
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("404-por-permiso es INDISTINGUIBLE de 404-por-inexistente (mismo status y cuerpo)", async () => {
    getServerSession.mockResolvedValue(ASESOR_SR);

    findUnique.mockResolvedValueOnce(convWith({ contact: { assignedToId: "otro-asesor" } }));
    const resPermiso = await GET(req(), { params: { id: "conv1" } });
    const bodyPermiso = await resPermiso.json();

    findUnique.mockResolvedValueOnce(null);
    const resInexistente = await GET(req(), { params: { id: "conv1" } });
    const bodyInexistente = await resInexistente.json();

    expect(resPermiso.status).toBe(404);
    expect(resPermiso.status).toBe(resInexistente.status);
    expect(bodyPermiso).toEqual(bodyInexistente);
  });
});
