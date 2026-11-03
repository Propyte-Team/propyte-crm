import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { recruitCandidate: { findMany: (...a: unknown[]) => findMany(...a) }, contact: { findMany: vi.fn().mockResolvedValue([]) } },
}));

import { aFila, listarCandidatos } from "./reclutamiento";

const BASE = {
  id: "c1", fullName: "Ana", age: null, email: null, phone: null, area: null, plaza: null, portfolioUrl: null,
  notes: null, stage: "RECIBIDO", source: "CHAT", createdAt: new Date("2026-11-03T00:00:00Z"), files: [],
};

beforeEach(() => findMany.mockReset());

describe("aFila con lo del bot", () => {
  it("mapea columnas bot*, y conversationId = sourceRef solo con CHAT", () => {
    const f = aFila({
      ...BASE, sourceRef: "conv-1", botCanal: "INSTAGRAM", botResultado: "APTO", botPuntaje: 72, botMotivo: "puntaje",
      botResumen: "ok", botRespuestas: { movilidad: "SI", vacia: "", n: 3 }, botDesglose: { a: 1 }, horarioEntrevista: "lunes", cvUrl: "x.com/cv",
    });
    expect(f).toMatchObject({
      conversationId: "conv-1", botCanal: "INSTAGRAM", botResultado: "APTO", botPuntaje: 72, botMotivo: "puntaje",
      botResumen: "ok", botRespuestas: { movilidad: "SI", n: "3" }, botDesglose: { a: 1 }, horarioEntrevista: "lunes", cvUrl: "x.com/cv",
    });
    expect(aFila({ ...BASE, source: "MANUAL", sourceRef: "algo" }).conversationId).toBeNull();
  });
  it("sin columnas del bot (base vieja) → todo null", () => {
    const f = aFila(BASE);
    expect([f.botResultado, f.botRespuestas, f.cvUrl, f.conversationId, f.botDesglose]).toEqual([null, null, null, null, null]);
  });
});

describe("listarCandidatos sin el SQL del bot", () => {
  it("P2022 → reintenta sin las columnas del bot y la lista sale", async () => {
    findMany.mockRejectedValueOnce(Object.assign(new Error("col"), { code: "P2022" })).mockResolvedValueOnce([BASE]);
    const filas = await listarCandidatos();
    expect(filas.map((f) => f.id)).toEqual(["c1"]);
    expect(findMany.mock.calls[0][0].select.cvUrl).toBe(true);
    expect(findMany.mock.calls[1][0].select.cvUrl).toBeUndefined();
  });
  it("P2021 (tabla faltante) se propaga para el aviso de migración", async () => {
    findMany.mockRejectedValueOnce(Object.assign(new Error("tabla"), { code: "P2021" }));
    await expect(listarCandidatos()).rejects.toMatchObject({ code: "P2021" });
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
