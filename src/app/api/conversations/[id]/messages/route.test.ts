import { describe, it, expect, vi, beforeEach } from "vitest";

const sendChannelMessage = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();
const getServerSession = vi.fn();
const assignContact = vi.fn();
// getServerSession ahora es un vi.fn() (antes async fijo) para poder simular
// distintos roles/ids por test (mando vs asesor) en el describe de abajo.
vi.mock("@/lib/auth/session", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock("@/lib/messaging/dispatcher", () => ({ sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...a) }));
vi.mock("@/lib/inbox/assign", () => ({ assignContact: (...a: unknown[]) => assignContact(...a) }));
vi.mock("@/lib/db", () => ({ default: {
  conversation: { findUnique: (...a: unknown[]) => findUnique(...a), update: (...a: unknown[]) => update(...a) },
  message: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
} }));

import { POST } from "./route";

// Fixture base de conversación con contact.assignedToId=null (hilo libre) por default.
// convWith() clona y mezcla overrides del contact — los tests viejos que no lo tocan
// siguen mandando fixtures inline sin assignedToId (undefined se comporta como null
// en los gates de abajo, así que no se rompen).
const baseConv = {
  id: "conv1",
  channel: "INSTAGRAM" as const,
  status: "HUMAN" as const,
  connectorId: "conn_ig",
  contact: { id: "c1", phone: null as string | null, doNotContact: false, assignedToId: null as string | null },
};

function convWith(
  overrides: Partial<Omit<typeof baseConv, "contact">> & { contact?: Partial<typeof baseConv.contact> } = {}
): typeof baseConv {
  const { contact, ...rest } = overrides;
  return { ...baseConv, ...rest, contact: { ...baseConv.contact, ...contact } };
}

beforeEach(() => {
  getServerSession.mockReset().mockResolvedValue({ user: { id: "u1", role: "ASESOR" } });
  sendChannelMessage.mockReset().mockResolvedValue({ id: "m1" });
  findUnique.mockReset();
  update.mockReset();
  assignContact.mockReset().mockResolvedValue({ ok: true, assignedTo: null });
});

it("pasa connectorId de la conversación a sendChannelMessage", async () => {
  findUnique.mockResolvedValue({ id: "conv1", channel: "INSTAGRAM", status: "HUMAN", connectorId: "conn_ig", contact: { id: "c1", phone: null, doNotContact: false } });
  const r = new Request("https://x", { method: "POST", body: JSON.stringify({ body: "hola" }) }) as never;
  await POST(r, { params: { id: "conv1" } });
  expect(sendChannelMessage).toHaveBeenCalledWith("INSTAGRAM", "c1", "hola", "u1", { connectorId: "conn_ig", media: null });
});

it("acepta media sin texto y lo pasa a sendChannelMessage", async () => {
  findUnique.mockResolvedValue({ id: "conv1", channel: "MESSENGER", status: "HUMAN", connectorId: "conn_ms", contact: { id: "c1", phone: null, doNotContact: false } });
  const media = { path: "2026-07/a.jpg", type: "image", filename: "a.jpg", mimeType: "image/jpeg" };
  const r = new Request("https://x", { method: "POST", body: JSON.stringify({ media }) }) as never;
  const res = await POST(r, { params: { id: "conv1" } });
  expect(res.status).toBe(201);
  expect(sendChannelMessage).toHaveBeenCalledWith("MESSENGER", "c1", "", "u1", { connectorId: "conn_ms", media });
});

it("rechaza mensaje sin texto NI media, nota interna con media, y media.path con URL", async () => {
  findUnique.mockResolvedValue({ id: "conv1", channel: "MESSENGER", status: "HUMAN", connectorId: "c", contact: { id: "c1", phone: null, doNotContact: false } });
  const cases = [
    {},
    { body: "nota", internalNote: true, media: { path: "a.jpg", type: "image" } },
    { media: { path: "https://evil.com/x.jpg", type: "image" } },
  ];
  for (const body of cases) {
    const r = new Request("https://x", { method: "POST", body: JSON.stringify(body) }) as never;
    const res = await POST(r, { params: { id: "conv1" } });
    expect(res.status).toBe(400);
  }
  expect(sendChannelMessage).not.toHaveBeenCalled();
});

describe("gate de asignación + auto-claim", () => {
  it("403 si el contacto está asignado a otro asesor y el remitente no es mando", async () => {
    findUnique.mockResolvedValue(convWith({ contact: { assignedToId: "u2" } }));
    const r = new Request("https://x", { method: "POST", body: JSON.stringify({ body: "hola" }) }) as never;
    const res = await POST(r, { params: { id: "conv1" } });
    expect(res.status).toBe(403);
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("mando (GERENTE) escribe en hilo ajeno → 201 y no reclama", async () => {
    getServerSession.mockResolvedValue({ user: { id: "mgr1", role: "GERENTE" } });
    findUnique.mockResolvedValue(convWith({ contact: { assignedToId: "u2" } }));
    const r = new Request("https://x", { method: "POST", body: JSON.stringify({ body: "hola" }) }) as never;
    const res = await POST(r, { params: { id: "conv1" } });
    expect(res.status).toBe(201);
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("mando (GERENTE) en hilo LIBRE → 201 y no reclama (triagea sin quedarse el lead)", async () => {
    getServerSession.mockResolvedValue({ user: { id: "mgr1", role: "GERENTE" } });
    findUnique.mockResolvedValue(convWith({ contact: { assignedToId: null } }));
    const r = new Request("https://x", { method: "POST", body: JSON.stringify({ body: "hola" }) }) as never;
    const res = await POST(r, { params: { id: "conv1" } });
    expect(res.status).toBe(201);
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("asesor (ASESOR_SR) en hilo libre → 201 y auto-claim con los datos correctos", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u3", role: "ASESOR_SR" } });
    findUnique.mockResolvedValue(convWith({ contact: { assignedToId: null } }));
    const r = new Request("https://x", { method: "POST", body: JSON.stringify({ body: "hola" }) }) as never;
    const res = await POST(r, { params: { id: "conv1" } });
    expect(res.status).toBe(201);
    expect(assignContact).toHaveBeenCalledWith({
      contactId: "c1",
      assigneeId: "u3",
      actor: { id: "u3", role: "ASESOR_SR" },
      conversationId: "conv1",
      source: "inbox_autoclaim",
    });
  });

  // Decisión: cuando el hilo YA es del remitente, el gate no bloquea (assignedToId ===
  // session.user.id) y el auto-claim tampoco corre (el check es "!assignedToId", que ya
  // no es null). assignContact ni se invoca — no hay nada que reclamar.
  it("asesor en hilo que YA es suyo → 201, no reclama (assignedToId no es null)", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u3", role: "ASESOR_SR" } });
    findUnique.mockResolvedValue(convWith({ contact: { assignedToId: "u3" } }));
    const r = new Request("https://x", { method: "POST", body: JSON.stringify({ body: "hola" }) }) as never;
    const res = await POST(r, { params: { id: "conv1" } });
    expect(res.status).toBe(201);
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("nota interna en hilo ajeno → 201, sin gate y sin auto-claim", async () => {
    findUnique.mockResolvedValue(convWith({ contact: { assignedToId: "u2" } }));
    const r = new Request("https://x", { method: "POST", body: JSON.stringify({ body: "nota", internalNote: true }) }) as never;
    const res = await POST(r, { params: { id: "conv1" } });
    expect(res.status).toBe(201);
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("si assignContact falla (throw), el envío sigue en 201 (best-effort, no revierte)", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u3", role: "ASESOR_SR" } });
    findUnique.mockResolvedValue(convWith({ contact: { assignedToId: null } }));
    assignContact.mockRejectedValue(new Error("boom"));
    const r = new Request("https://x", { method: "POST", body: JSON.stringify({ body: "hola" }) }) as never;
    const res = await POST(r, { params: { id: "conv1" } });
    expect(res.status).toBe(201);
  });

  it("orden: si el envío falla, NO se intenta auto-claim (el claim va después del envío exitoso)", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u3", role: "ASESOR_SR" } });
    findUnique.mockResolvedValue(convWith({ contact: { assignedToId: null } }));
    sendChannelMessage.mockRejectedValue(new Error("fallo de envío"));
    const r = new Request("https://x", { method: "POST", body: JSON.stringify({ body: "hola" }) }) as never;
    const res = await POST(r, { params: { id: "conv1" } });
    expect(res.status).toBe(422);
    expect(assignContact).not.toHaveBeenCalled();
  });
});
