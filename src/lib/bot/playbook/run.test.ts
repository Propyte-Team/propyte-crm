import { describe, it, expect, vi, beforeEach } from "vitest";

const extractFields = vi.fn();
const coerceCapture = vi.fn();
const applyCapture = vi.fn();
const detectDuplicatesForContact = vi.fn();
const nextTask = vi.fn();
const buildObjective = vi.fn();

vi.mock("./extract", () => ({ extractFields: (...a: unknown[]) => extractFields(...a) }));
vi.mock("./capture", () => ({ coerceCapture: (...a: unknown[]) => coerceCapture(...a) }));
vi.mock("./apply", () => ({ applyCapture: (...a: unknown[]) => applyCapture(...a) }));
vi.mock("@/lib/contacts/duplicate-alert", () => ({ detectDuplicatesForContact: (...a: unknown[]) => detectDuplicatesForContact(...a) }));
vi.mock("./engine", () => ({
  nextTask: (...a: unknown[]) => nextTask(...a),
  buildObjective: (...a: unknown[]) => buildObjective(...a),
  COMPLETION_OBJECTIVE: "listo",
}));

import { runPlaybookStep } from "./run";

function makeDb(completedTaskKeys: string[] = []) {
  return {
    conversationPlaybookState: {
      upsert: vi.fn(async () => ({ id: "state1", completedTaskKeys })),
      update: vi.fn(async () => ({})),
    },
    contact: {
      findUnique: vi.fn(async () => ({ id: "contact1", firstName: "A" })),
    },
  };
}

const phoneTask = {
  key: "capture_phone", order: 1, objective: "pide el teléfono", targetField: "phone",
  captureType: "PHONE", enumOptions: null, required: true, skipIfFilled: true,
};
const emailTask = {
  key: "capture_email", order: 2, objective: "pide el email", targetField: "email",
  captureType: "EMAIL", enumOptions: null, required: true, skipIfFilled: true,
};
const textTask = {
  key: "capture_zone", order: 3, objective: "pide la zona", targetField: "preferredZone",
  captureType: "ZONE", enumOptions: null, required: false, skipIfFilled: true,
};

beforeEach(() => {
  [extractFields, coerceCapture, applyCapture, detectDuplicatesForContact, nextTask, buildObjective].forEach((m) => m.mockReset());
  applyCapture.mockResolvedValue(undefined);
  detectDuplicatesForContact.mockResolvedValue(undefined);
  nextTask.mockReturnValue(null);
  buildObjective.mockReturnValue("siguiente objetivo");
});

describe("runPlaybookStep — hook de detección de duplicados (Caso 1)", () => {
  it("captura exitosa de PHONE → llama detectDuplicatesForContact con el contactId", async () => {
    const db = makeDb();
    extractFields.mockResolvedValue({ capture_phone: "9991112233" });
    coerceCapture.mockReturnValue({ ok: true, writes: [{ field: "phone", value: "+529991112233" }] });
    await runPlaybookStep(db as never, {
      playbook: { id: "pb1", tasks: [phoneTask] },
      conversationId: "conv1",
      contact: { id: "contact1" },
      messages: [],
      model: "m",
    });
    expect(applyCapture).toHaveBeenCalled();
    expect(detectDuplicatesForContact).toHaveBeenCalledWith("contact1");
  });

  it("captura exitosa de EMAIL → también dispara la detección", async () => {
    const db = makeDb();
    extractFields.mockResolvedValue({ capture_email: "ana@x.com" });
    coerceCapture.mockReturnValue({ ok: true, writes: [{ field: "email", value: "ana@x.com" }] });
    await runPlaybookStep(db as never, {
      playbook: { id: "pb1", tasks: [emailTask] },
      conversationId: "conv1",
      contact: { id: "contact1" },
      messages: [],
      model: "m",
    });
    expect(detectDuplicatesForContact).toHaveBeenCalledWith("contact1");
  });

  it("captura exitosa de un captureType distinto (ZONE) → NO dispara la detección", async () => {
    const db = makeDb();
    extractFields.mockResolvedValue({ capture_zone: "Tulum" });
    coerceCapture.mockReturnValue({ ok: true, writes: [{ field: "preferredZone", value: "Tulum" }] });
    await runPlaybookStep(db as never, {
      playbook: { id: "pb1", tasks: [textTask] },
      conversationId: "conv1",
      contact: { id: "contact1" },
      messages: [],
      model: "m",
    });
    expect(applyCapture).toHaveBeenCalled();
    expect(detectDuplicatesForContact).not.toHaveBeenCalled();
  });

  it("coerción fallida (ok:false) → no aplica ni detecta duplicados", async () => {
    const db = makeDb();
    extractFields.mockResolvedValue({ capture_phone: "no es un teléfono" });
    coerceCapture.mockReturnValue({ ok: false, writes: [] });
    await runPlaybookStep(db as never, {
      playbook: { id: "pb1", tasks: [phoneTask] },
      conversationId: "conv1",
      contact: { id: "contact1" },
      messages: [],
      model: "m",
    });
    expect(applyCapture).not.toHaveBeenCalled();
    expect(detectDuplicatesForContact).not.toHaveBeenCalled();
  });

  it("si detectDuplicatesForContact lanza, el step NO se rompe (best-effort)", async () => {
    const db = makeDb();
    extractFields.mockResolvedValue({ capture_phone: "9991112233" });
    coerceCapture.mockReturnValue({ ok: true, writes: [{ field: "phone", value: "+529991112233" }] });
    detectDuplicatesForContact.mockRejectedValue(new Error("boom"));
    nextTask.mockReturnValue({ key: "capture_email", order: 2, objective: "x", targetField: "email" });
    const result = await runPlaybookStep(db as never, {
      playbook: { id: "pb1", tasks: [phoneTask] },
      conversationId: "conv1",
      contact: { id: "contact1" },
      messages: [],
      model: "m",
    });
    expect(result.status).toBe("IN_PROGRESS");
    expect(result.objective).toBe("siguiente objetivo");
  });
});

// Marcas del agente (2026-10-09, revisión final): el hilo tiene UN solo ConversationPlaybookState.
// Si es de otro playbook (p. ej. el global corrió antes de asignarle una marca a la cuenta), sus
// tareas cumplidas no son avance del playbook de la marca. Con `ignoreForeignState` se reinicia
// para este playbook; sin la bandera (camino sin marca) todo queda exactamente igual.
describe("runPlaybookStep — estado de otro playbook (ignoreForeignState)", () => {
  function dbWithState(state: { playbookId: string; completedTaskKeys: string[] }) {
    const db = makeDb(state.completedTaskKeys);
    db.conversationPlaybookState.upsert = vi.fn(async () => ({ id: "state1", ...state }));
    return db;
  }

  it("con la bandera y estado de OTRO playbook → se reinicia para este y sus tareas no cuentan", async () => {
    const db = dbWithState({ playbookId: "pb-global", completedTaskKeys: ["capture_phone"] });
    extractFields.mockResolvedValue({});
    nextTask.mockReturnValue(phoneTask);

    const result = await runPlaybookStep(db as never, {
      playbook: { id: "pb-yax", tasks: [phoneTask] },
      conversationId: "conv1",
      contact: { id: "contact1" },
      messages: [],
      model: "m",
      ignoreForeignState: true,
    });

    expect(db.conversationPlaybookState.update).toHaveBeenCalledWith({
      where: { conversationId: "conv1" },
      data: expect.objectContaining({
        playbookId: "pb-yax",
        status: "IN_PROGRESS",
        currentTaskKey: null,
        completedTaskKeys: [],
        completedAt: null,
      }),
    });
    // la tarea "capture_phone" del otro playbook NO cuenta: sigue pendiente y se extrae
    expect(extractFields).toHaveBeenCalledWith(
      expect.objectContaining({ tasks: [expect.objectContaining({ key: "capture_phone" })] }),
    );
    expect(nextTask).toHaveBeenCalledWith(expect.anything(), [], expect.anything());
    expect(result.objective).toBe("siguiente objetivo");
  });

  it("con la bandera y estado del MISMO playbook → se conserva el avance (no se reinicia)", async () => {
    const db = dbWithState({ playbookId: "pb-yax", completedTaskKeys: ["capture_phone"] });

    await runPlaybookStep(db as never, {
      playbook: { id: "pb-yax", tasks: [phoneTask] },
      conversationId: "conv1",
      contact: { id: "contact1" },
      messages: [],
      model: "m",
      ignoreForeignState: true,
    });

    const resets = db.conversationPlaybookState.update.mock.calls.filter(
      (c: unknown[]) => (c[0] as { data: { playbookId?: string } }).data.playbookId !== undefined,
    );
    expect(resets).toHaveLength(0);
    expect(nextTask).toHaveBeenCalledWith(expect.anything(), ["capture_phone"], expect.anything());
  });

  it("SIN la bandera, el estado de otro playbook se usa tal cual (comportamiento de siempre)", async () => {
    const db = dbWithState({ playbookId: "pb-global", completedTaskKeys: ["capture_phone"] });

    await runPlaybookStep(db as never, {
      playbook: { id: "pb-yax", tasks: [phoneTask] },
      conversationId: "conv1",
      contact: { id: "contact1" },
      messages: [],
      model: "m",
    });

    const resets = db.conversationPlaybookState.update.mock.calls.filter(
      (c: unknown[]) => (c[0] as { data: { playbookId?: string } }).data.playbookId !== undefined,
    );
    expect(resets).toHaveLength(0);
    expect(nextTask).toHaveBeenCalledWith(expect.anything(), ["capture_phone"], expect.anything());
  });
});
