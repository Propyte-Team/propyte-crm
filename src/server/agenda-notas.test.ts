import { describe, it, expect, vi, beforeEach } from "vitest";

// HUB #860: notas sobre una reunión o llamada de la Agenda.

const activityFindUnique = vi.fn();
const activityFindMany = vi.fn();
const createActivity = vi.fn();
let puedeModificar = true;

vi.mock("@/lib/db", () => ({
  default: {
    activity: {
      findUnique: (...a: unknown[]) => activityFindUnique(...a),
      findMany: (...a: unknown[]) => activityFindMany(...a),
    },
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "user-1", role: "ASESOR_SR" } }),
}));
vi.mock("@/lib/activities/permissions", () => ({
  canModifyActivity: (_role: string, isOwner: boolean) => isOwner || puedeModificar,
}));
vi.mock("@/server/activities", () => ({
  createActivity: (...a: unknown[]) => createActivity(...a),
}));

import { addCitaNota, getCitaNotas } from "./agenda-notas";

const CITA = {
  id: "cita-1",
  userId: "user-1",
  activityType: "CALL_OUTBOUND",
  subject: "Llamada de prueba",
  contactId: "contact-1",
  dealId: null,
};

beforeEach(() => {
  puedeModificar = true;
  activityFindUnique.mockReset().mockResolvedValue(CITA);
  activityFindMany.mockReset().mockResolvedValue([]);
  createActivity.mockReset().mockResolvedValue({
    id: "nota-1",
    createdAt: new Date("2026-10-13T17:00:00.000Z"),
    user: { id: "user-1", name: "Ana" },
  });
});

describe("addCitaNota", () => {
  it("crea una NOTE ligada a la cita, con su contacto y el texto como descripción", async () => {
    const nota = await addCitaNota("cita-1", "Quiere visitar el showroom");

    expect(createActivity).toHaveBeenCalledWith({
      activityType: "NOTE",
      subject: "Nota: Llamada de prueba",
      description: "Quiere visitar el showroom",
      contactId: "contact-1",
      dealId: undefined,
      parentActivityId: "cita-1",
    });
    expect(nota).toEqual({
      id: "nota-1",
      texto: "Quiere visitar el showroom",
      createdAt: "2026-10-13T17:00:00.000Z",
      autor: "Ana",
    });
  });

  it("recorta el asunto a 200 caracteres", async () => {
    activityFindUnique.mockResolvedValue({ ...CITA, subject: "x".repeat(250) });
    await addCitaNota("cita-1", "Hola");
    expect(createActivity.mock.calls[0][0].subject).toHaveLength(200);
  });

  it("no acepta notas sobre una tarea, una nota o una actividad borrada", async () => {
    activityFindUnique.mockResolvedValue({ ...CITA, activityType: "TASK" });
    await expect(addCitaNota("cita-1", "Hola")).rejects.toThrow("Reunión o llamada no encontrada");

    activityFindUnique.mockResolvedValue(null);
    await expect(addCitaNota("cita-1", "Hola")).rejects.toThrow("Reunión o llamada no encontrada");

    expect(createActivity).not.toHaveBeenCalled();
  });

  it("no deja escribir en la cita de otro sin permiso", async () => {
    puedeModificar = false;
    activityFindUnique.mockResolvedValue({ ...CITA, userId: "otro" });
    await expect(addCitaNota("cita-1", "Hola")).rejects.toThrow("permiso");
    expect(createActivity).not.toHaveBeenCalled();
  });
});

describe("getCitaNotas", () => {
  it("lee solo las NOTE vivas de esa cita, más recientes primero", async () => {
    activityFindMany.mockResolvedValue([
      { id: "n-2", subject: "Nota: x", description: "Segunda", createdAt: new Date("2026-10-13T18:00:00Z"), user: { name: "Ana" } },
      { id: "n-1", subject: "Nota: x", description: null, createdAt: new Date("2026-10-13T17:00:00Z"), user: null },
    ]);

    const notas = await getCitaNotas("cita-1");

    const args = activityFindMany.mock.calls[0][0];
    expect(args.where).toEqual({ parentActivityId: "cita-1", activityType: "NOTE", deletedAt: null });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(notas.map((n) => n.texto)).toEqual(["Segunda", "Nota: x"]);
    expect(notas[1].autor).toBeNull();
  });

  it("sin permiso sobre la cita no lee nada", async () => {
    puedeModificar = false;
    activityFindUnique.mockResolvedValue({ ...CITA, userId: "otro" });
    await expect(getCitaNotas("cita-1")).rejects.toThrow("permiso");
    expect(activityFindMany).not.toHaveBeenCalled();
  });
});
