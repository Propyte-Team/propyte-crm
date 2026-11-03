import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { recruitCandidate: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));

import { candidatoDeContacto } from "./reclutamiento";

const FILA = {
  id: "c1", stage: "ENTREVISTA", source: "CHAT", sourceRef: "conv-1", botResultado: "APTO", botPuntaje: 72,
  botResumen: "Buen perfil", horarioEntrevista: "lunes 10am", cvUrl: "https://drive.google.com/x",
  files: [{ id: "f9" }],
};

beforeEach(() => findFirst.mockReset());

describe("candidatoDeContacto", () => {
  it("encontrado: filtra por contacto vigente y devuelve lo del bot + el último CV", async () => {
    findFirst.mockResolvedValueOnce(FILA);
    const c = await candidatoDeContacto("k1");
    expect(c).toEqual({
      id: "c1", stage: "ENTREVISTA", source: "CHAT", sourceRef: "conv-1", botResultado: "APTO", botPuntaje: 72,
      botResumen: "Buen perfil", horarioEntrevista: "lunes 10am", cvUrl: "https://drive.google.com/x", cvFileId: "f9",
    });
    const arg = findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ contactId: "k1", deletedAt: null });
    expect(arg.select.files).toMatchObject({ where: { kind: "CV", deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1 });
  });
  it("sin CV de archivo → cvFileId null", async () => {
    findFirst.mockResolvedValueOnce({ ...FILA, files: [] });
    expect((await candidatoDeContacto("k1"))?.cvFileId).toBeNull();
  });
  it("no encontrado → null", async () => {
    findFirst.mockResolvedValueOnce(null);
    expect(await candidatoDeContacto("k1")).toBeNull();
  });
  it("P2022 / P2021 (falta el SQL) → null, sin tumbar la ficha", async () => {
    findFirst.mockRejectedValueOnce(Object.assign(new Error("col"), { code: "P2022" }));
    expect(await candidatoDeContacto("k1")).toBeNull();
    findFirst.mockRejectedValueOnce(Object.assign(new Error("tabla"), { code: "P2021" }));
    expect(await candidatoDeContacto("k1")).toBeNull();
  });
  it("cualquier otro error tampoco llega a la ficha → null", async () => {
    findFirst.mockRejectedValueOnce(new Error("conexión"));
    expect(await candidatoDeContacto("k1")).toBeNull();
  });
});
