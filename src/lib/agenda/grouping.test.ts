import { describe, it, expect } from "vitest";
import { cancunDayKey, bucketFor, groupAgenda, type AgendaItem } from "./grouping";

// Cancún es UTC−5 sin horario de verano.
describe("cancunDayKey", () => {
  it("usa el día civil de Cancún, no el de UTC", () => {
    // 2026-07-27T02:00:00Z son las 21:00 del 26 de julio en Cancún.
    expect(cancunDayKey(new Date("2026-07-27T02:00:00Z"))).toBe("2026-07-26");
  });

  it("cruza al día siguiente a partir de las 05:00Z", () => {
    expect(cancunDayKey(new Date("2026-07-27T05:00:00Z"))).toBe("2026-07-27");
  });
});

describe("bucketFor", () => {
  // Cancún: 26 de julio, 21:00.
  const now = new Date("2026-07-27T02:00:00Z");

  it("sin fecha cae en sin_fecha", () => {
    expect(bucketFor(null, now)).toBe("sin_fecha");
  });

  it("una fecha anterior al día de hoy es vencida", () => {
    expect(bucketFor(new Date("2026-07-25T18:00:00Z"), now)).toBe("vencidas");
  });

  it("el mismo día civil de Cancún es hoy", () => {
    expect(bucketFor(new Date("2026-07-26T14:00:00Z"), now)).toBe("hoy");
  });

  it("no confunde el día de UTC con el de Cancún", () => {
    // 2026-07-27T10:00:00Z es el 27 en Cancún → mañana, no hoy.
    // Con lógica UTC ingenua ambos serían 2026-07-27 y esto diría "hoy".
    expect(bucketFor(new Date("2026-07-27T10:00:00Z"), now)).toBe("semana");
  });

  it("el sexto día por delante todavía es esta semana", () => {
    expect(bucketFor(new Date("2026-08-01T14:00:00Z"), now)).toBe("semana");
  });

  it("el séptimo día por delante ya es después", () => {
    expect(bucketFor(new Date("2026-08-02T14:00:00Z"), now)).toBe("despues");
  });

  it("un string no parseable degrada a sin_fecha en vez de lanzar", () => {
    expect(bucketFor("basura", now)).toBe("sin_fecha");
  });

  it("un Date inválido degrada a sin_fecha en vez de lanzar", () => {
    expect(bucketFor(new Date("invalid"), now)).toBe("sin_fecha");
  });
});

describe("groupAgenda", () => {
  const now = new Date("2026-07-27T02:00:00Z");

  const item = (id: string, dueDate: string | null): AgendaItem => ({
    id,
    subject: `Tarea ${id}`,
    activityType: "TASK",
    status: "PENDIENTE",
    dueDate,
    contactId: null,
    contactName: null,
  });

  it("reparte cada item en su bucket y conserva el orden de entrada", () => {
    const result = groupAgenda(
      [
        item("a", "2026-07-25T18:00:00Z"),
        item("b", "2026-07-26T14:00:00Z"),
        item("c", "2026-07-24T18:00:00Z"),
        item("d", null),
      ],
      now,
    );

    expect(result.vencidas.map((i) => i.id)).toEqual(["a", "c"]);
    expect(result.hoy.map((i) => i.id)).toEqual(["b"]);
    expect(result.semana).toEqual([]);
    expect(result.despues).toEqual([]);
    expect(result.sin_fecha.map((i) => i.id)).toEqual(["d"]);
  });

  it("devuelve los cinco buckets aunque estén vacíos", () => {
    const result = groupAgenda([], now);
    expect(Object.keys(result).sort()).toEqual(
      ["despues", "hoy", "semana", "sin_fecha", "vencidas"],
    );
  });

  it("un ítem con dueDate corrupto no tumba la agrupación y no afecta a los demás", () => {
    expect(() =>
      groupAgenda(
        [
          item("a", "2026-07-25T18:00:00Z"),
          item("b", "basura"),
          item("c", "2026-07-26T14:00:00Z"),
        ],
        now,
      ),
    ).not.toThrow();

    const result = groupAgenda(
      [
        item("a", "2026-07-25T18:00:00Z"),
        item("b", "basura"),
        item("c", "2026-07-26T14:00:00Z"),
      ],
      now,
    );

    expect(result.vencidas.map((i) => i.id)).toEqual(["a"]);
    expect(result.hoy.map((i) => i.id)).toEqual(["c"]);
    expect(result.sin_fecha.map((i) => i.id)).toEqual(["b"]);
  });
});
