import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const convFindUnique = vi.fn();
const convUpdate = vi.fn();
const connFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    conversation: {
      findUnique: (...a: unknown[]) => convFindUnique(...a),
      // capturado (antes era un vi.fn() inline inalcanzable): los tests del gate genérico
      // necesitan afirmar que un hilo fuera de alcance NO llega a escribir en la BD.
      update: (...a: unknown[]) => convUpdate(...a),
    },
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

// Fixture del findUnique del bloque assign. Por default: hilo LIBRE (sin dueño), que es
// lo que ve todo el mundo — el alcance se prueba explícitamente donde importa.
function convAssign(
  contact: { assignedToId: string | null; assignedTo?: { teamLeaderId: string | null } | null } = {
    assignedToId: null,
    assignedTo: null,
  }
) {
  return { id: "conv-1", contactId: "c1", contact: { assignedTo: null, ...contact } };
}

// Fixture del findUnique del gate GENÉRICO (takeover/release/close/snooze/toggle_bot),
// que trae más campos que el de assign. Por default: hilo libre y sin controlador.
function convGenerica(
  contact: { assignedToId: string | null; assignedTo?: { teamLeaderId: string | null } | null } = {
    assignedToId: null,
    assignedTo: null,
  },
  controlledById: string | null = null
) {
  return {
    id: "conv-1",
    controlledById,
    botEnabled: true,
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    contact: {
      id: "c1",
      whatsappOptOut: false,
      firstName: "Ana",
      lastName: "Lopez",
      assignedTo: null,
      ...contact,
    },
  };
}

beforeEach(() => {
  [
    getServerSession,
    convFindUnique,
    convUpdate,
    connFindUnique,
    markConversationAsSpam,
    recordMetaResult,
    blockOnMeta,
    getSocialPageToken,
    assignContact,
  ].forEach((m) => m.mockReset());
  getServerSession.mockResolvedValue({ user: { id: "user-1", role: "ADMIN" } });
  convUpdate.mockResolvedValue({ id: "conv-1", botEnabled: false });
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
  it("se resuelve ANTES del gate genérico: asesor NO dueño puede reclamar un hilo libre", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    // hilo SIN dueño — el gate genérico (isOwner || mando) lo habría rechazado con 403
    convFindUnique.mockResolvedValue(convAssign());
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
    convFindUnique.mockResolvedValue(convAssign());
    assignContact.mockResolvedValue({ ok: false, code: "sin-permiso" });
    const res = await POST(req({ action: "assign", assigneeId: "ase-9" }), PARAMS);
    expect(res.status).toBe(403);
  });

  // Los códigos del módulo se mapean igual, pero ahora solo llegan desde hilos DENTRO del
  // alcance (la sesión por default es ADMIN, vista completa): ya-asignado ya no puede
  // aparecer en un hilo que el usuario ni ve — ese caso lo corta el 404 de abajo.
  it.each([
    ["ya-asignado", 409],
    ["no-existe", 404],
    ["usuario-invalido", 422],
    ["conflicto", 409],
  ])("mapea %s → %i", async (code, status) => {
    convFindUnique.mockResolvedValue(convAssign());
    assignContact.mockResolvedValue({ ok: false, code });
    const res = await POST(req({ action: "assign", assigneeId: "ase-2" }), PARAMS);
    expect(res.status).toBe(status);
  });

  it("assigneeId ausente → 400 (null explícito sí es válido: desasignar)", async () => {
    const res = await POST(req({ action: "assign" }), PARAMS);
    expect(res.status).toBe(400);
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("assigneeId de solo espacios → 400 en el borde (zod .trim() antes de .min(1)), no llega al módulo", async () => {
    const res = await POST(req({ action: "assign", assigneeId: "   " }), PARAMS);
    expect(res.status).toBe(400);
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("assigneeId null llega al módulo como null", async () => {
    convFindUnique.mockResolvedValue(convAssign());
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
    convFindUnique.mockResolvedValue(convAssign());
    assignContact.mockResolvedValue({ ok: true, assignedTo: { id: "ase-2", name: "Pedro Ruiz" } });
    const res = await POST(req({ action: "assign", assigneeId: "ase-2" }), PARAMS);
    const body = await res.json();
    expect(body.data.assignedTo).toEqual({ id: "ase-2", name: "Pedro Ruiz" });
  });

  // Alcance (mismo criterio que leer y escribir, @/lib/inbox/scope): fuera de alcance el
  // hilo NO existe. Antes, un asesor que ni veía el hilo recibía 409 "ya está asignado a
  // otro asesor" — confirmación gratis de existencia y estado.
  it("asesor sobre hilo de OTRO → 404 y assignContact ni se llama", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    convFindUnique.mockResolvedValue(
      convAssign({ assignedToId: "ase-9", assignedTo: { teamLeaderId: "tl-1" } })
    );
    const res = await POST(req({ action: "assign", assigneeId: "ase-1" }), PARAMS);
    expect(res.status).toBe(404);
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("ese 404 es INDISTINGUIBLE del de conversación inexistente", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    convFindUnique.mockResolvedValueOnce(
      convAssign({ assignedToId: "ase-9", assignedTo: { teamLeaderId: "tl-1" } })
    );
    const resAlcance = await POST(req({ action: "assign", assigneeId: "ase-1" }), PARAMS);
    convFindUnique.mockResolvedValueOnce(null);
    const resInexistente = await POST(req({ action: "assign", assigneeId: "ase-1" }), PARAMS);
    expect(resAlcance.status).toBe(404);
    expect(resAlcance.status).toBe(resInexistente.status);
    expect(await resAlcance.json()).toEqual(await resInexistente.json());
  });

  it("TEAM_LEADER REASIGNA el hilo de un reporte directo → llega al módulo (200)", async () => {
    getServerSession.mockResolvedValue({ user: { id: "tl-1", role: "TEAM_LEADER" } });
    convFindUnique.mockResolvedValue(
      convAssign({ assignedToId: "rep-1", assignedTo: { teamLeaderId: "tl-1" } })
    );
    assignContact.mockResolvedValue({ ok: true, assignedTo: { id: "rep-2", name: "Otro" } });
    const res = await POST(req({ action: "assign", assigneeId: "rep-2" }), PARAMS);
    expect(res.status).toBe(200);
    expect(assignContact).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: "c1", assigneeId: "rep-2" })
    );
  });

  it("TEAM_LEADER sobre el hilo de un asesor que NO le reporta → 404", async () => {
    getServerSession.mockResolvedValue({ user: { id: "tl-1", role: "TEAM_LEADER" } });
    convFindUnique.mockResolvedValue(
      convAssign({ assignedToId: "ajeno-1", assignedTo: { teamLeaderId: "otro-tl" } })
    );
    const res = await POST(req({ action: "assign", assigneeId: "rep-2" }), PARAMS);
    expect(res.status).toBe(404);
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("sin-permiso (403) queda solo para el ROL: hilo VISIBLE que el usuario no puede poseer", async () => {
    getServerSession.mockResolvedValue({ user: { id: "h-1", role: "HOSTESS" } });
    convFindUnique.mockResolvedValue(convAssign()); // hilo libre: sí lo ve
    assignContact.mockResolvedValue({ ok: false, code: "sin-permiso" });
    const res = await POST(req({ action: "assign", assigneeId: "h-1" }), PARAMS);
    expect(res.status).toBe(403);
  });

  it("un throw del módulo NO se convierte en 4xx", async () => {
    convFindUnique.mockResolvedValue(convAssign());
    assignContact.mockRejectedValue(new Error("BD caída"));
    await expect(POST(req({ action: "assign", assigneeId: "ase-2" }), PARAMS)).rejects.toThrow("BD caída");
  });
});

// Tercera puerta del inbox: comandar el hilo. Comparte la definición de alcance con leer
// (GET /api/conversations/[id]) y escribir (POST .../messages) — @/lib/inbox/scope.
describe("POST acciones del hilo — alcance antes que permiso", () => {
  it("TEAM_LEADER cierra el hilo de un REPORTE DIRECTO → 200 (pasa el gate)", async () => {
    getServerSession.mockResolvedValue({ user: { id: "tl-1", role: "TEAM_LEADER" } });
    convFindUnique.mockResolvedValue(
      convGenerica({ assignedToId: "rep-1", assignedTo: { teamLeaderId: "tl-1" } })
    );
    const res = await POST(req({ action: "close" }), PARAMS);
    expect(res.status).toBe(200);
    expect(convUpdate).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { status: "CLOSED", controlledById: null },
    });
  });

  it("TEAM_LEADER sobre el hilo de un asesor que NO le reporta → 404 y NO escribe en la BD", async () => {
    getServerSession.mockResolvedValue({ user: { id: "tl-1", role: "TEAM_LEADER" } });
    convFindUnique.mockResolvedValue(
      convGenerica({ assignedToId: "ajeno-1", assignedTo: { teamLeaderId: "otro-tl" } })
    );
    const res = await POST(req({ action: "close" }), PARAMS);
    expect(res.status).toBe(404);
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it("ASESOR_SR sobre hilo ajeno → 404 (antes era 403 del gate genérico)", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    convFindUnique.mockResolvedValue(
      convGenerica({ assignedToId: "ase-9", assignedTo: { teamLeaderId: "tl-1" } })
    );
    const res = await POST(req({ action: "takeover" }), PARAMS);
    expect(res.status).toBe(404);
    expect(convUpdate).not.toHaveBeenCalled();
  });

  // El ORDEN es la afirmación: el 404 por invisibilidad va ANTES del 403 por no ser dueño.
  // Si se invirtieran, el "Sin permiso sobre este hilo" delataría que el hilo existe a
  // quien ni siquiera lo ve en la lista.
  it("el 404 por invisibilidad es INDISTINGUIBLE del de conversación inexistente", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    convFindUnique.mockResolvedValueOnce(
      convGenerica({ assignedToId: "ase-9", assignedTo: { teamLeaderId: "tl-1" } })
    );
    const resInvisible = await POST(req({ action: "close" }), PARAMS);
    convFindUnique.mockResolvedValueOnce(null);
    const resInexistente = await POST(req({ action: "close" }), PARAMS);

    expect(resInvisible.status).toBe(404);
    expect(resInvisible.status).toBe(resInexistente.status);
    expect(await resInvisible.json()).toEqual(await resInexistente.json());
  });

  // Contraparte del anterior: el 403 NO desapareció, solo dejó de aplicar a lo invisible.
  // Hilo SIN asignar = visible para cualquiera, pero el asesor no es dueño ni controlador.
  it("hilo VISIBLE (sin asignar) y usuario que no es dueño ni mando → sigue siendo 403", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    convFindUnique.mockResolvedValue(convGenerica({ assignedToId: null, assignedTo: null }));
    const res = await POST(req({ action: "close" }), PARAMS);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Sin permiso sobre este hilo" });
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it("el dueño del contacto conserva su acceso (regresión del gate original)", async () => {
    getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR_SR" } });
    convFindUnique.mockResolvedValue(
      convGenerica({ assignedToId: "ase-1", assignedTo: { teamLeaderId: "tl-1" } })
    );
    const res = await POST(req({ action: "close" }), PARAMS);
    expect(res.status).toBe(200);
  });

  it("mark_spam sigue ANTES de todo esto: su gate es canMarkSpam, sin chequeo de alcance", async () => {
    // MANTENIMIENTO no ve ningún hilo por alcance y tampoco pasaría el gate genérico,
    // pero mark_spam se resuelve antes de leer la conversación: no debe tocarse.
    getServerSession.mockResolvedValue({ user: { id: "user-9", role: "MANTENIMIENTO" } });
    const res = await POST(req({ action: "mark_spam" }), PARAMS);
    expect(res.status).toBe(200);
    expect(convFindUnique).not.toHaveBeenCalled();
  });
});
