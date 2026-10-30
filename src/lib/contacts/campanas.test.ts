import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadCampaign: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import { crearCampana, errorDeCampana } from "./campanas";

beforeEach(() => [findFirst, findUnique, create, update].forEach((m) => m.mockReset()));

describe("errorDeCampana (#937)", () => {
  it("existe y no está archivada: válida", async () => {
    findFirst.mockResolvedValue({ id: "c1" });
    expect(await errorDeCampana("c1")).toBeNull();
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: "c1", archivedAt: null });
  });
  it("no existe (o archivada): mensaje", async () => {
    findFirst.mockResolvedValue(null);
    expect(await errorDeCampana("c1")).toBe("La campaña o evento elegido no existe");
  });
  it("la que el contacto ya tiene se acepta sin consultar (aunque se haya archivado)", async () => {
    expect(await errorDeCampana("c1", "c1")).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("crearCampana (#937 «Crear +»)", () => {
  it("nueva: nombre limpio, clave y tipo", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "c1", name: "Expo Mérida 2026", kind: "EVENTO" });
    const r = await crearCampana(" Expo  Mérida 2026", "EVENTO", "u1");
    expect(r).toEqual({ ok: true, creada: true, data: { id: "c1", name: "Expo Mérida 2026", kind: "EVENTO" } });
    expect(create.mock.calls[0][0].data).toEqual({
      name: "Expo Mérida 2026",
      nameKey: "expo merida 2026",
      kind: "EVENTO",
      createdById: "u1",
    });
  });
  it("tipo inválido: error sin tocar la base", async () => {
    expect(await crearCampana("Algo", "OTRO", "u1")).toEqual({ ok: false, error: "Elige si es campaña o evento" });
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("ya existía: devuelve la existente con SU tipo", async () => {
    findUnique.mockResolvedValue({ id: "c9", name: "Expo Mérida 2026", kind: "EVENTO", archivedAt: null });
    const r = await crearCampana("expo merida 2026", "CAMPANA", "u1");
    expect(r).toEqual({ ok: true, creada: false, data: { id: "c9", name: "Expo Mérida 2026", kind: "EVENTO" } });
    expect(create).not.toHaveBeenCalled();
  });
});
