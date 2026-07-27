import { describe, it, expect, vi, beforeEach } from "vitest";

const createActivity = vi.fn();

vi.mock("@/server/activities", () => ({
  createActivity: (...a: unknown[]) => createActivity(...a),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/agenda/activities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  createActivity.mockReset();
  createActivity.mockResolvedValue({ id: "act-1", contactId: null });
});

describe("POST /api/agenda/activities", () => {
  it("crea una TASK personal y responde 201", async () => {
    const res = await POST(req({ activityType: "TASK", subject: "Preparar propuesta" }));

    expect(res.status).toBe(201);
    expect(createActivity).toHaveBeenCalledOnce();
    const arg = createActivity.mock.calls[0][0];
    expect(arg.activityType).toBe("TASK");
    expect(arg.subject).toBe("Preparar propuesta");
    // La captura es personal por construcción: contactId no existe en el input.
    expect(arg.contactId).toBeUndefined();
  });

  it("rechaza un contactId aunque venga en el body", async () => {
    const res = await POST(
      req({
        activityType: "TASK",
        subject: "Colar una actividad ajena",
        contactId: "11111111-1111-1111-1111-111111111111",
      }),
    );

    expect(res.status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("rechaza un tipo que no sea TASK o NOTE", async () => {
    const res = await POST(req({ activityType: "CALL_OUTBOUND", subject: "Llamada" }));
    expect(res.status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("rechaza un asunto demasiado corto", async () => {
    const res = await POST(req({ activityType: "TASK", subject: "ab" }));
    expect(res.status).toBe(400);
  });

  it("rechaza un asunto de puros espacios", async () => {
    // min(3) debe evaluarse sobre el string YA recortado — si se evalúa antes
    // del trim, "   " (3 espacios) pasa el mínimo y persiste un asunto vacío.
    const res = await POST(req({ activityType: "TASK", subject: "   " }));
    expect(res.status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("acepta 199 caracteres reales con espacios alrededor que rebasan 200 en crudo", async () => {
    // Falso rechazo si max(200) se evalúa antes del trim: el contenido visible
    // cabe, pero el string crudo con espacios de sobra no.
    const subject = " " + "a".repeat(199) + "    ";
    const res = await POST(req({ activityType: "TASK", subject }));
    expect(res.status).toBe(201);
    expect(createActivity.mock.calls[0][0].subject).toBe("a".repeat(199));
  });

  it("ancla una fecha sin hora a medianoche de Cancún, no de UTC", async () => {
    // <input type="date"> manda "2026-07-30". Con z.coerce.date() eso sería
    // medianoche UTC = 19:00 del 29 en Cancún, y la tarea caería un día antes
    // en la agenda. Medianoche de Cancún (UTC−5) son las 05:00Z.
    await POST(req({ activityType: "TASK", subject: "Junta del jueves", dueDate: "2026-07-30" }));

    const dueDate = createActivity.mock.calls[0][0].dueDate;
    expect(dueDate).toBeInstanceOf(Date);
    expect(dueDate.toISOString()).toBe("2026-07-30T05:00:00.000Z");
  });

  it("respeta un datetime completo tal cual viene", async () => {
    await POST(req({
      activityType: "TASK",
      subject: "Llamada de las 10",
      dueDate: "2026-07-30T16:00:00.000Z",
    }));
    expect(createActivity.mock.calls[0][0].dueDate.toISOString()).toBe("2026-07-30T16:00:00.000Z");
  });

  it("rechaza una fecha ilegible", async () => {
    const res = await POST(req({ activityType: "TASK", subject: "Fecha rota", dueDate: "no-es-fecha" }));
    expect(res.status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("rechaza una fecha de calendario imposible (30 de febrero)", async () => {
    // El parser ISO de JS hace rollover silencioso: "2026-02-30" se
    // convertiría en 2 de marzo si solo se comprueba !isNaN(getTime()).
    const res = await POST(req({ activityType: "TASK", subject: "Fecha imposible", dueDate: "2026-02-30" }));
    expect(res.status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("rechaza una fecha de calendario imposible (31 de abril)", async () => {
    const res = await POST(req({ activityType: "TASK", subject: "Fecha imposible", dueDate: "2026-04-31" }));
    expect(res.status).toBe(400);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("acepta una fecha límite de calendario válida (28 de febrero)", async () => {
    await POST(req({ activityType: "TASK", subject: "Fin de mes", dueDate: "2026-02-28" }));
    const dueDate = createActivity.mock.calls[0][0].dueDate;
    expect(dueDate.toISOString()).toBe("2026-02-28T05:00:00.000Z");
  });

  it("pasa la description intacta a createActivity", async () => {
    await POST(req({
      activityType: "NOTE",
      subject: "Nota de seguimiento",
      description: "Detalle largo de la nota",
    }));
    expect(createActivity.mock.calls[0][0].description).toBe("Detalle largo de la nota");
  });

  it("traduce la falta de sesión a 401", async () => {
    createActivity.mockRejectedValue(new Error("No autorizado"));
    const res = await POST(req({ activityType: "TASK", subject: "Cualquier cosa" }));
    expect(res.status).toBe(401);
  });
});
