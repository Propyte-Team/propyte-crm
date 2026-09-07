import { describe, it, expect, vi } from "vitest";

// Tarjeta #715, bug A-01. El botón "completar" del widget de tareas vencidas mandaba su
// PATCH a `/api/activities` —la colección—, que solo exporta GET y POST. Cada clic
// recibía un 405 que un `catch {}` vacío se tragaba: no completaba y no avisaba.
//
// Esta prueba fija el contrato que el componente asume. Si alguien mueve el PATCH de
// sitio, o lo agrega a la colección, se entera aquí y no en producción.

vi.mock("@/lib/db", () => ({ default: {} }));
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => null }));
vi.mock("@/server/activities", () => ({
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));

import * as coleccion from "./route";
import * as elemento from "./[id]/route";

describe("contrato de las rutas de actividades (#715 A-01)", () => {
  it("la colección /api/activities solo lista y crea", () => {
    expect(typeof coleccion.GET).toBe("function");
    expect(typeof coleccion.POST).toBe("function");
    // Lo que el componente daba por hecho que existía:
    expect((coleccion as Record<string, unknown>).PATCH).toBeUndefined();
  });

  it("el elemento /api/activities/[id] es el que actualiza y borra", () => {
    expect(typeof elemento.PATCH).toBe("function");
    expect(typeof elemento.DELETE).toBe("function");
  });
});
