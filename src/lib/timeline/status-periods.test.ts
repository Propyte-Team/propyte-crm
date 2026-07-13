import { describe, it, expect, vi, afterEach } from "vitest";
import { computeStatusPeriods } from "./status-periods";

const createdAt = new Date("2026-07-01T00:00:00Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("computeStatusPeriods", () => {
  it("sin cambios: un único período abierto con currentStatus desde createdAt hasta ahora", () => {
    const now = new Date("2026-07-04T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const periods = computeStatusPeriods([], createdAt, "NUEVO");

    expect(periods).toEqual([
      {
        status: "NUEVO",
        enteredAt: createdAt.toISOString(),
        exitedAt: null,
        durationMs: now.getTime() - createdAt.getTime(),
      },
    ]);
  });

  it("un cambio: período inicial cerrado (old del cambio) + período abierto (currentStatus)", () => {
    const now = new Date("2026-07-05T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const changedAt = new Date("2026-07-02T00:00:00Z");
    const periods = computeStatusPeriods(
      [{ oldValue: "NUEVO", newValue: "CONTACTADO", changedAt }],
      createdAt,
      "CONTACTADO"
    );

    expect(periods).toHaveLength(2);
    expect(periods[0]).toEqual({
      status: "NUEVO",
      enteredAt: createdAt.toISOString(),
      exitedAt: changedAt.toISOString(),
      durationMs: changedAt.getTime() - createdAt.getTime(),
    });
    expect(periods[1]).toEqual({
      status: "CONTACTADO",
      enteredAt: changedAt.toISOString(),
      exitedAt: null,
      durationMs: now.getTime() - changedAt.getTime(),
    });
  });

  it("varios cambios: un período por cambio + inicial + final abierto, en orden cronológico", () => {
    const now = new Date("2026-07-10T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const c1 = new Date("2026-07-02T00:00:00Z");
    const c2 = new Date("2026-07-05T00:00:00Z");
    const c3 = new Date("2026-07-08T00:00:00Z");

    // Pasadas fuera de orden a propósito: la función debe ordenar internamente por changedAt.
    const periods = computeStatusPeriods(
      [
        { oldValue: "CONTACTADO", newValue: "REUNION", changedAt: c2 },
        { oldValue: "NUEVO", newValue: "CONTACTADO", changedAt: c1 },
        { oldValue: "REUNION", newValue: "PROSPECTO", changedAt: c3 },
      ],
      createdAt,
      "PROSPECTO"
    );

    expect(periods.map((p) => p.status)).toEqual(["NUEVO", "CONTACTADO", "REUNION", "PROSPECTO"]);
    expect(periods.map((p) => p.enteredAt)).toEqual([
      createdAt.toISOString(),
      c1.toISOString(),
      c2.toISOString(),
      c3.toISOString(),
    ]);
    expect(periods.map((p) => p.exitedAt)).toEqual([
      c1.toISOString(),
      c2.toISOString(),
      c3.toISOString(),
      null,
    ]);
    expect(periods[periods.length - 1].durationMs).toBe(now.getTime() - c3.getTime());
  });

  it("el período abierto siempre usa `now()` para calcular su duración", () => {
    const now1 = new Date("2026-07-06T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now1);
    const periods1 = computeStatusPeriods([], createdAt, "NUEVO");
    expect(periods1[0].durationMs).toBe(now1.getTime() - createdAt.getTime());

    const now2 = new Date("2026-07-09T00:00:00Z");
    vi.setSystemTime(now2);
    const periods2 = computeStatusPeriods([], createdAt, "NUEVO");
    expect(periods2[0].durationMs).toBe(now2.getTime() - createdAt.getTime());
  });
});
