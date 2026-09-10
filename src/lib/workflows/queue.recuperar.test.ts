import { describe, it, expect, vi, beforeEach } from "vitest";

// Auditoría 2026-09-10: `runQueue` reclama la fila poniéndola en RUNNING y sólo la mueve a
// DONE/FAILED cuando `executeAction` termina. Si el proceso muere en medio (reinicio del
// VPS, despliegue, `maxDuration` agotado) la fila se quedaba en RUNNING para siempre: el
// selector sólo mira PENDING, así que nadie la retomaba y nadie la marcaba fallida. Un
// correo o un WhatsApp que el motor dio por encolado y no se manda nunca, sin aparecer en
// ningún contador de errores.

const findMany = vi.fn();
const updateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    actionQueue: {
      findMany: (...a: unknown[]) => findMany(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
  },
}));
vi.mock("./actions", () => ({ executeAction: vi.fn() }));

import { recuperarEncalladas } from "./queue";

beforeEach(() => {
  findMany.mockReset();
  updateMany.mockReset();
  updateMany.mockResolvedValue({ count: 1 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** Los datos que `recuperarEncalladas` selecciona de cada fila. */
function fila(extra: Record<string, unknown> = {}) {
  return {
    id: "aq-1",
    attempts: 1,
    maxAttempts: 3,
    actionType: "SEND_WHATSAPP",
    entityId: "c1",
    ...extra,
  };
}

describe("recuperarEncalladas — a quién busca", () => {
  it("busca sólo RUNNING con startedAt anterior al umbral", async () => {
    findMany.mockResolvedValue([]);
    const antes = Date.now();

    await recuperarEncalladas();

    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe("RUNNING");
    // Diez minutos de holgura: una acción legítima no pasa de los 60s del tick, así que
    // el umbral no puede rescatar una que todavía esté corriendo (sería duplicar el envío).
    const limite = where.startedAt.lt.getTime();
    expect(antes - limite).toBeGreaterThanOrEqual(10 * 60_000 - 50);
    expect(antes - limite).toBeLessThan(11 * 60_000);
  });

  it("sin encalladas no toca nada", async () => {
    findMany.mockResolvedValue([]);

    const r = await recuperarEncalladas();

    expect(r).toEqual({ reencoladas: 0, agotadas: 0 });
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("recuperarEncalladas — qué hace con cada una", () => {
  it("con intentos restantes la reencola como PENDING y exigible ya", async () => {
    findMany.mockResolvedValue([fila({ attempts: 1, maxAttempts: 3 })]);

    const r = await recuperarEncalladas();

    expect(r).toEqual({ reencoladas: 1, agotadas: 0 });
    const { where, data } = updateMany.mock.calls[0][0];
    expect(data.status).toBe("PENDING");
    expect(data.startedAt).toBeNull(); // si no, el próximo rescate la vería encallada otra vez
    expect(data.runAfter).toBeInstanceOf(Date);
    // Guard de estado: si otro runner la resucitó entre el findMany y esto, no la pisa.
    expect(where.status).toBe("RUNNING");
    expect(where.id).toBe("aq-1");
  });

  it("sin intentos restantes la cierra como FAILED, no la reencola en bucle", async () => {
    findMany.mockResolvedValue([fila({ attempts: 3, maxAttempts: 3 })]);

    const r = await recuperarEncalladas();

    expect(r).toEqual({ reencoladas: 0, agotadas: 1 });
    const { data } = updateMany.mock.calls[0][0];
    expect(data.status).toBe("FAILED");
    expect(data.finishedAt).toBeInstanceOf(Date);
    expect(String(data.error)).toContain("Encallada");
  });

  it("deja constancia del motivo en `error` al reencolar", async () => {
    findMany.mockResolvedValue([fila()]);

    await recuperarEncalladas();

    expect(String(updateMany.mock.calls[0][0].data.error)).toContain("RUNNING");
  });

  it("si otro runner ya la tomó (count 0) no la cuenta como rescatada", async () => {
    findMany.mockResolvedValue([fila()]);
    updateMany.mockResolvedValue({ count: 0 });

    const r = await recuperarEncalladas();

    expect(r).toEqual({ reencoladas: 0, agotadas: 0 });
  });

  it("procesa un lote mezclado y cuenta cada caso por separado", async () => {
    findMany.mockResolvedValue([
      fila({ id: "a", attempts: 1, maxAttempts: 3 }),
      fila({ id: "b", attempts: 3, maxAttempts: 3 }),
      fila({ id: "c", attempts: 2, maxAttempts: 3 }),
    ]);

    const r = await recuperarEncalladas();

    expect(r).toEqual({ reencoladas: 2, agotadas: 1 });
    expect(updateMany).toHaveBeenCalledTimes(3);
  });

  it("respeta el tamaño de lote que se le pide", async () => {
    findMany.mockResolvedValue([]);

    await recuperarEncalladas(7);

    expect(findMany.mock.calls[0][0].take).toBe(7);
  });
});
