import { describe, it, expect, vi, beforeEach } from "vitest";

const updateActivity = vi.fn();

vi.mock("@/server/activities", () => ({
  updateActivity: (...a: unknown[]) => updateActivity(...a),
}));

import { PATCH } from "./route";

const CONTACT = "11111111-1111-1111-1111-111111111111";

function req(body: unknown) {
  return new Request("http://localhost/api/agenda/citas/act-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}
const props = { params: Promise.resolve({ id: "act-1" }) };

const valida = {
  activityType: "MEETING_PRESENTIAL",
  subject: "Reunión reprogramada",
  dueDate: "2026-10-21T11:00",
};

beforeEach(() => {
  updateActivity.mockReset();
  updateActivity.mockResolvedValue({ id: "act-1" });
});

describe("PATCH /api/agenda/citas/[id]", () => {
  it("edita la cita y responde 200", async () => {
    const res = await PATCH(req({ ...valida, contactId: CONTACT, durationMinutes: 30 }), props);

    expect(res.status).toBe(200);
    expect(updateActivity).toHaveBeenCalledOnce();
    const [id, data] = updateActivity.mock.calls[0];
    expect(id).toBe("act-1");
    expect(data.subject).toBe("Reunión reprogramada");
    expect(data.activityType).toBe("MEETING_PRESENTIAL");
    expect(data.contactId).toBe(CONTACT);
    expect(data.duration_minutes).toBe(30);
  });

  it("ancla la fecha sin zona a la hora de Cancún (UTC−5)", async () => {
    await PATCH(req(valida), props);
    const { dueDate } = updateActivity.mock.calls[0][1];
    expect(dueDate.toISOString()).toBe("2026-10-21T16:00:00.000Z");
  });

  it("descripción vacía o null se manda como null (borrar), omitida no se toca", async () => {
    await PATCH(req({ ...valida, description: "   " }), props);
    expect(updateActivity.mock.calls[0][1].description).toBeNull();

    updateActivity.mockClear();
    await PATCH(req({ ...valida, description: null }), props);
    expect(updateActivity.mock.calls[0][1].description).toBeNull();

    updateActivity.mockClear();
    await PATCH(req(valida), props);
    expect(updateActivity.mock.calls[0][1].description).toBeUndefined();
  });

  it("duración null borra la duración; omitida no la toca", async () => {
    await PATCH(req({ ...valida, durationMinutes: null }), props);
    expect(updateActivity.mock.calls[0][1].duration_minutes).toBeNull();

    updateActivity.mockClear();
    await PATCH(req(valida), props);
    expect(updateActivity.mock.calls[0][1].duration_minutes).toBeUndefined();
  });

  it("rechaza status, userId, dealId y cualquier campo fuera del schema (strict)", async () => {
    for (const extra of [{ status: "COMPLETADA" }, { userId: CONTACT }, { dealId: CONTACT }]) {
      expect((await PATCH(req({ ...valida, ...extra }), props)).status).toBe(400);
    }
    expect(updateActivity).not.toHaveBeenCalled();
  });

  it("rechaza TASK, NOTE y tipos que no son reunión o llamada", async () => {
    for (const activityType of ["TASK", "NOTE", "EMAIL_SENT"]) {
      expect((await PATCH(req({ ...valida, activityType }), props)).status).toBe(400);
    }
    expect(updateActivity).not.toHaveBeenCalled();
  });

  it("rechaza asunto corto, fecha faltante o imposible, contactId no uuid y duración fuera de rango", async () => {
    const { dueDate: _omit, ...sinFecha } = valida;
    expect((await PATCH(req({ ...valida, subject: "ab" }), props)).status).toBe(400);
    expect((await PATCH(req(sinFecha), props)).status).toBe(400);
    expect((await PATCH(req({ ...valida, dueDate: "2026-02-30T10:00" }), props)).status).toBe(400);
    expect((await PATCH(req({ ...valida, contactId: "no-es-uuid" }), props)).status).toBe(400);
    expect((await PATCH(req({ ...valida, durationMinutes: 0 }), props)).status).toBe(400);
    expect((await PATCH(req({ ...valida, durationMinutes: 481 }), props)).status).toBe(400);
    expect(updateActivity).not.toHaveBeenCalled();
  });

  it("traduce los errores del servidor: 401, 403, 404 (actividad y contacto) y 400 de tipo", async () => {
    const casos: [string, number][] = [
      ["No autorizado", 401],
      ["No tienes permiso para editar esta actividad", 403],
      ["Actividad no encontrada", 404],
      ["Contacto no encontrado", 404],
      ["Tipo de actividad no válido para esta actividad", 400],
    ];
    for (const [msg, status] of casos) {
      updateActivity.mockRejectedValueOnce(new Error(msg));
      expect((await PATCH(req(valida), props)).status).toBe(status);
    }
  });
});
