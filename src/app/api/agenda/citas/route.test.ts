import { describe, it, expect, vi, beforeEach } from "vitest";

const createActivity = vi.fn();

vi.mock("@/server/activities", () => ({
  createActivity: (...a: unknown[]) => createActivity(...a),
}));

import { POST } from "./route";

const CONTACT = "11111111-1111-1111-1111-111111111111";

function req(body: unknown) {
  return new Request("http://localhost/api/agenda/citas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const validMeeting = {
  activityType: "MEETING_VIRTUAL",
  subject: "Presentación de propuesta",
  dueDate: "2026-10-20T10:00",
  contactId: CONTACT,
};

beforeEach(() => {
  createActivity.mockReset();
  createActivity.mockResolvedValue({ id: "act-1", contactId: CONTACT });
});

describe("POST /api/agenda/citas", () => {
  it("crea una reunión PENDIENTE ligada al contacto y responde 201", async () => {
    const res = await POST(req(validMeeting));

    expect(res.status).toBe(201);
    expect(createActivity).toHaveBeenCalledOnce();
    const arg = createActivity.mock.calls[0][0];
    expect(arg.activityType).toBe("MEETING_VIRTUAL");
    expect(arg.contactId).toBe(CONTACT);
    // Sin status explícito createActivity la marcaría COMPLETADA y no saldría en la tabla.
    expect(arg.status).toBe("PENDIENTE");
  });

  it("crea una llamada saliente PENDIENTE", async () => {
    const res = await POST(
      req({ activityType: "CALL_OUTBOUND", subject: "Llamar para dar seguimiento", dueDate: "2026-10-20T16:30", contactId: CONTACT }),
    );

    expect(res.status).toBe(201);
    expect(createActivity.mock.calls[0][0].status).toBe("PENDIENTE");
    expect(createActivity.mock.calls[0][0].activityType).toBe("CALL_OUTBOUND");
  });

  it("acepta los cinco tipos de reunión y llamada", async () => {
    for (const activityType of [
      "MEETING_VIRTUAL",
      "MEETING_PRESENTIAL",
      "MEETING_SHOWROOM",
      "CALL_OUTBOUND",
      "CALL_INBOUND",
    ]) {
      const res = await POST(req({ ...validMeeting, activityType }));
      expect(res.status).toBe(201);
    }
    expect(createActivity).toHaveBeenCalledTimes(5);
  });

  it("pasa la duración a createActivity como duration_minutes", async () => {
    await POST(req({ ...validMeeting, durationMinutes: 45 }));
    expect(createActivity.mock.calls[0][0].duration_minutes).toBe(45);
  });

  it("ancla un datetime-local sin zona a la hora de Cancún (UTC−5)", async () => {
    // "2026-10-20T10:00" en Cancún son las 15:00Z. Con new Date() sobre el string, un
    // servidor en UTC lo tomaría como 10:00Z y la reunión caería 5 horas antes.
    await POST(req(validMeeting));
    const dueDate = createActivity.mock.calls[0][0].dueDate;
    expect(dueDate).toBeInstanceOf(Date);
    expect(dueDate.toISOString()).toBe("2026-10-20T15:00:00.000Z");
  });

  it("rechaza si falta el contacto", async () => {
    const { contactId: _omit, ...sinContacto } = validMeeting;
    const res = await POST(req(sinContacto));
    expect(res.status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("rechaza un contactId que no es uuid", async () => {
    const res = await POST(req({ ...validMeeting, contactId: "no-es-uuid" }));
    expect(res.status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("rechaza si falta la fecha", async () => {
    const { dueDate: _omit, ...sinFecha } = validMeeting;
    const res = await POST(req(sinFecha));
    expect(res.status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("rechaza TASK, NOTE y cualquier tipo que no sea reunión o llamada", async () => {
    for (const activityType of ["TASK", "NOTE", "EMAIL_SENT"]) {
      const res = await POST(req({ ...validMeeting, activityType }));
      expect(res.status).toBe(400);
    }
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("rechaza un asunto corto o de puros espacios", async () => {
    expect((await POST(req({ ...validMeeting, subject: "ab" }))).status).toBe(400);
    expect((await POST(req({ ...validMeeting, subject: "     " }))).status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("rechaza una duración fuera de rango o no entera", async () => {
    expect((await POST(req({ ...validMeeting, durationMinutes: 0 }))).status).toBe(400);
    expect((await POST(req({ ...validMeeting, durationMinutes: 481 }))).status).toBe(400);
    expect((await POST(req({ ...validMeeting, durationMinutes: 30.5 }))).status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("rechaza status, userId y dealId en el body (strict)", async () => {
    expect((await POST(req({ ...validMeeting, status: "COMPLETADA" }))).status).toBe(400);
    expect((await POST(req({ ...validMeeting, userId: CONTACT }))).status).toBe(400);
    expect((await POST(req({ ...validMeeting, dealId: CONTACT }))).status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("rechaza una fecha imposible (30 de febrero)", async () => {
    const res = await POST(req({ ...validMeeting, dueDate: "2026-02-30T10:00" }));
    expect(res.status).toBe(400);
  });

  it("traduce la falta de sesión a 401", async () => {
    createActivity.mockRejectedValue(new Error("No autorizado"));
    const res = await POST(req(validMeeting));
    expect(res.status).toBe(401);
  });

  it("responde 404 si el contacto no existe", async () => {
    createActivity.mockRejectedValue(new Error("Contacto no encontrado"));
    const res = await POST(req(validMeeting));
    expect(res.status).toBe(404);
  });
});
