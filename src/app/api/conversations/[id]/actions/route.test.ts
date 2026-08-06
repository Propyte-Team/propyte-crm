import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const convFindUnique = vi.fn();
const connFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    conversation: { findUnique: (...a: unknown[]) => convFindUnique(...a), update: vi.fn() },
    leadConnector: { findUnique: (...a: unknown[]) => connFindUnique(...a) },
    activity: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const markConversationAsSpam = vi.fn();
const recordMetaResult = vi.fn();
vi.mock("@/lib/moderation/block-sender", () => ({
  markConversationAsSpam: (...a: unknown[]) => markConversationAsSpam(...a),
  recordMetaResult: (...a: unknown[]) => recordMetaResult(...a),
}));

const blockOnMeta = vi.fn();
vi.mock("@/lib/moderation/meta-moderation", () => ({
  blockOnMeta: (...a: unknown[]) => blockOnMeta(...a),
}));

const getSocialPageToken = vi.fn();
vi.mock("@/lib/messaging/social-accounts", () => ({
  getSocialPageToken: (...a: unknown[]) => getSocialPageToken(...a),
}));

const assignContact = vi.fn();
vi.mock("@/lib/inbox/assign", () => ({
  assignContact: (...a: unknown[]) => assignContact(...a),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://x/api/conversations/conv-1/actions", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}

const PARAMS = { params: { id: "conv-1" } };

beforeEach(() => {
  [
    getServerSession,
    convFindUnique,
    connFindUnique,
    markConversationAsSpam,
    recordMetaResult,
    blockOnMeta,
    getSocialPageToken,
    assignContact,
  ].forEach((m) => m.mockReset());
  getServerSession.mockResolvedValue({ user: { id: "user-1", role: "ADMIN" } });
  markConversationAsSpam.mockResolvedValue({
    ok: true,
    blockedSenderId: "blocked-1",
    channel: "INSTAGRAM",
    identifier: "IGSID-1",
    connectorId: "conn-ig",
  });
  connFindUnique.mockResolvedValue({ id: "conn-ig", config: { pageId: "PAGE-1" } });
  getSocialPageToken.mockReturnValue("TOKEN");
  blockOnMeta.mockResolvedValue({ blockStatus: "SENT", spamStatus: "SENT" });
});

describe("POST mark_spam", () => {
  it("403 si el rol no puede borrar contactos, aunque sea dueño del hilo", async () => {
    getServerSession.mockResolvedValue({ user: { id: "user-1", role: "ASESOR" } });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(403);
    expect(markConversationAsSpam).not.toHaveBeenCalled();
  });

  it("permite MANTENIMIENTO, que el gate genérico de la ruta rechazaría", async () => {
    getServerSession.mockResolvedValue({ user: { id: "user-9", role: "MANTENIMIENTO" } });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(200);
  });

  it("409 con el detalle si el contacto tiene negocio", async () => {
    markConversationAsSpam.mockResolvedValue({ ok: false, code: "tiene-negocio", deals: 2, walkIns: 0 });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("2");
    expect(blockOnMeta).not.toHaveBeenCalled();
  });

  it("422 si no hay identificador bloqueable", async () => {
    markConversationAsSpam.mockResolvedValue({ ok: false, code: "sin-identificador" });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(422);
  });

  it("404 si la conversación no existe", async () => {
    markConversationAsSpam.mockResolvedValue({ ok: false, code: "no-existe" });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(404);
  });

  it("limpia el CRM, bloquea en Meta y devuelve las dos mitades", async () => {
    const res = await POST(req({ action: "mark_spam", reason: "cripto" }), PARAMS);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { blockedSenderId: "blocked-1", meta: { blockStatus: "SENT", spamStatus: "SENT" } },
    });
    expect(markConversationAsSpam).toHaveBeenCalledWith({
      conversationId: "conv-1",
      actorId: "user-1",
      reason: "cripto",
    });
    expect(blockOnMeta).toHaveBeenCalledWith({
      channel: "INSTAGRAM",
      pageId: "PAGE-1",
      token: "TOKEN",
      identifier: "IGSID-1",
    });
    expect(recordMetaResult).toHaveBeenCalledWith("blocked-1", { blockStatus: "SENT", spamStatus: "SENT" });
  });

  it("un fallo de Meta NO tumba la respuesta: 200 con el estado FAILED", async () => {
    blockOnMeta.mockResolvedValue({ blockStatus: "FAILED", spamStatus: "SKIPPED", error: "tope alcanzado" });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.meta.blockStatus).toBe("FAILED");
    expect(body.data.meta.error).toBe("tope alcanzado");
  });

  it("sin conector, Meta queda SKIPPED y el CRM igual se limpia", async () => {
    markConversationAsSpam.mockResolvedValue({
      ok: true, blockedSenderId: "blocked-1", channel: "INSTAGRAM", identifier: "IGSID-1", connectorId: null,
    });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(200);
    expect(blockOnMeta).toHaveBeenCalledWith({
      channel: "INSTAGRAM", pageId: null, token: null, identifier: "IGSID-1",
    });
  });
});

describe("POST assign", () => {
  it("se resuelve ANTES del gate genérico: asesor NO dueño puede intentar claim", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    // hilo cuyo contacto es de OTRO — el gate genérico habría dado 403 antes de llegar
    convFindUnique.mockResolvedValue({ id: "conv-1", contactId: "c1" });
    assignContact.mockResolvedValue({ ok: true, assignedTo: { id: "ase-1", name: "Luisa" } });
    const res = await POST(req({ action: "assign", assigneeId: "ase-1" }), PARAMS);
    expect(res.status).toBe(200);
    expect(assignContact).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "c1",
        assigneeId: "ase-1",
        actor: { id: "ase-1", role: "ASESOR_SR" },
        conversationId: "conv-1",
      })
    );
  });

  it("la dirección contraria sigue cerrada: sin-permiso del módulo → 403", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    convFindUnique.mockResolvedValue({ id: "conv-1", contactId: "c1" });
    assignContact.mockResolvedValue({ ok: false, code: "sin-permiso" });
    const res = await POST(req({ action: "assign", assigneeId: "ase-9" }), PARAMS);
    expect(res.status).toBe(403);
  });

  it.each([
    ["ya-asignado", 409],
    ["no-existe", 404],
    ["usuario-invalido", 422],
    ["conflicto", 409],
  ])("mapea %s → %i", async (code, status) => {
    convFindUnique.mockResolvedValue({ id: "conv-1", contactId: "c1" });
    assignContact.mockResolvedValue({ ok: false, code });
    const res = await POST(req({ action: "assign", assigneeId: "ase-2" }), PARAMS);
    expect(res.status).toBe(status);
  });

  it("assigneeId ausente → 400 (null explícito sí es válido: desasignar)", async () => {
    const res = await POST(req({ action: "assign" }), PARAMS);
    expect(res.status).toBe(400);
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("assigneeId null llega al módulo como null", async () => {
    convFindUnique.mockResolvedValue({ id: "conv-1", contactId: "c1" });
    assignContact.mockResolvedValue({ ok: true, assignedTo: null });
    const res = await POST(req({ action: "assign", assigneeId: null }), PARAMS);
    expect(res.status).toBe(200);
    expect(assignContact).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: null }));
  });

  it("conversación inexistente → 404", async () => {
    convFindUnique.mockResolvedValue(null);
    const res = await POST(req({ action: "assign", assigneeId: "ase-2" }), PARAMS);
    expect(res.status).toBe(404);
  });

  it("devuelve assignedTo para el update optimista de la UI", async () => {
    convFindUnique.mockResolvedValue({ id: "conv-1", contactId: "c1" });
    assignContact.mockResolvedValue({ ok: true, assignedTo: { id: "ase-2", name: "Pedro Ruiz" } });
    const res = await POST(req({ action: "assign", assigneeId: "ase-2" }), PARAMS);
    const body = await res.json();
    expect(body.data.assignedTo).toEqual({ id: "ase-2", name: "Pedro Ruiz" });
  });
});
