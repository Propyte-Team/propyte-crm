import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #715, bug A-02: `completedAt` solo se escribía al completar. Reabrir una tarea
// la dejaba PENDIENTE con fecha de terminada, y cualquier reporte que cuente
// "completadas por fecha" la seguía contando.

const activityFindUnique = vi.fn();
const activityUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    activity: {
      findUnique: (...a: unknown[]) => activityFindUnique(...a),
      update: (...a: unknown[]) => activityUpdate(...a),
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "user-1", role: "ADMIN" } }),
}));

import { updateActivity } from "./activities";

beforeEach(() => {
  activityFindUnique.mockReset().mockResolvedValue({
    id: "act-1",
    userId: "user-1",
    status: "COMPLETADA",
    completedAt: new Date("2026-09-01T10:00:00.000Z"),
  });
  activityUpdate.mockReset().mockResolvedValue({ id: "act-1" });
});

/** Los campos que se mandaron a escribir. */
function datosEscritos(): Record<string, unknown> {
  return activityUpdate.mock.calls[0][0].data;
}

describe("updateActivity — completedAt (#715 A-02)", () => {
  it("al reabrir una tarea, borra la fecha de completado", async () => {
    await updateActivity("act-1", { status: "PENDIENTE" });

    expect(datosEscritos().status).toBe("PENDIENTE");
    expect(datosEscritos().completedAt).toBeNull();
  });

  it("al cancelar una tarea también la borra", async () => {
    await updateActivity("act-1", { status: "CANCELADA" });

    expect(datosEscritos().completedAt).toBeNull();
  });

  it("al completar, sella la fecha", async () => {
    await updateActivity("act-1", { status: "COMPLETADA" });

    expect(datosEscritos().completedAt).toBeInstanceOf(Date);
  });

  it("si no se toca el estado, no toca la fecha de completado", async () => {
    await updateActivity("act-1", { subject: "Otro título" });

    expect(datosEscritos()).not.toHaveProperty("completedAt");
  });

  it("acepta borrar la duración con null", async () => {
    // Antes la ruta convertía el null explícito en `undefined` ("no tocar"), así que una
    // duración puesta por error no se podía quitar nunca.
    await updateActivity("act-1", { duration_minutes: null });

    expect(datosEscritos().duration_minutes).toBeNull();
  });
});
