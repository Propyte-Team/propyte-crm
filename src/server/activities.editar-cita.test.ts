import { describe, it, expect, vi, beforeEach } from "vitest";

// HUB #859: editar contacto y tipo de una reunión o llamada desde la Agenda.

const activityFindUnique = vi.fn();
const activityUpdate = vi.fn();
const contactFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    activity: {
      findUnique: (...a: unknown[]) => activityFindUnique(...a),
      update: (...a: unknown[]) => activityUpdate(...a),
    },
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "user-1", role: "ADMIN" } }),
}));

import { updateActivity } from "./activities";

const CONTACT = "11111111-1111-1111-1111-111111111111";

function existente(activityType: string) {
  activityFindUnique.mockResolvedValue({
    id: "act-1",
    userId: "user-1",
    activityType,
    status: "PENDIENTE",
  });
}

function datosEscritos(): Record<string, unknown> {
  return activityUpdate.mock.calls[0][0].data;
}

beforeEach(() => {
  activityFindUnique.mockReset();
  activityUpdate.mockReset().mockResolvedValue({ id: "act-1" });
  contactFindUnique.mockReset().mockResolvedValue({ id: CONTACT });
  existente("CALL_OUTBOUND");
});

describe("updateActivity — contacto (#859)", () => {
  it("liga la actividad al contacto elegido", async () => {
    await updateActivity("act-1", { contactId: CONTACT });

    expect(datosEscritos().contact).toEqual({ connect: { id: CONTACT } });
  });

  it("si el contacto no existe, falla sin escribir", async () => {
    contactFindUnique.mockResolvedValue(null);

    await expect(updateActivity("act-1", { contactId: CONTACT })).rejects.toThrow("Contacto no encontrado");
    expect(activityUpdate).not.toHaveBeenCalled();
  });

  it("sin contactId no toca el contacto ni lo consulta", async () => {
    await updateActivity("act-1", { subject: "Otro asunto" });

    expect(datosEscritos()).not.toHaveProperty("contact");
    expect(contactFindUnique).not.toHaveBeenCalled();
  });
});

describe("updateActivity — tipo (#859)", () => {
  it("permite cambiar entre llamadas", async () => {
    await updateActivity("act-1", { activityType: "CALL_INBOUND" });
    expect(datosEscritos().activityType).toBe("CALL_INBOUND");
  });

  it("permite cambiar entre reuniones", async () => {
    existente("MEETING_VIRTUAL");
    await updateActivity("act-1", { activityType: "MEETING_SHOWROOM" });
    expect(datosEscritos().activityType).toBe("MEETING_SHOWROOM");
  });

  it("no deja convertir una llamada en reunión", async () => {
    await expect(updateActivity("act-1", { activityType: "MEETING_VIRTUAL" })).rejects.toThrow(
      "Tipo de actividad no válido",
    );
    expect(activityUpdate).not.toHaveBeenCalled();
  });

  it("no deja cambiar el tipo de una tarea", async () => {
    existente("TASK");
    await expect(updateActivity("act-1", { activityType: "CALL_OUTBOUND" })).rejects.toThrow(
      "Tipo de actividad no válido",
    );
    expect(activityUpdate).not.toHaveBeenCalled();
  });

  it("sin activityType no lo escribe", async () => {
    await updateActivity("act-1", { subject: "Otro asunto" });
    expect(datosEscritos()).not.toHaveProperty("activityType");
  });
});
