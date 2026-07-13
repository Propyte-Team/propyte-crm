import { describe, it, expect } from "vitest";
import { mergeTimeline } from "./merge";
import type { TimelineItem } from "./types";

function item(id: string, ts: string): TimelineItem {
  return { id, ts, kind: "activity", title: id };
}

describe("mergeTimeline", () => {
  it("mergea varias fuentes ya ordenadas y devuelve orden global descendente por ts", () => {
    const sourceA: TimelineItem[] = [item("a3", "2026-07-13T10:00:00Z"), item("a1", "2026-07-11T10:00:00Z")];
    const sourceB: TimelineItem[] = [item("b2", "2026-07-12T10:00:00Z"), item("b0", "2026-07-10T10:00:00Z")];

    const { items } = mergeTimeline([sourceA, sourceB], 10);

    expect(items.map((i) => i.id)).toEqual(["a3", "b2", "a1", "b0"]);
  });

  it("corta a `limit` y expone nextCursor = ts del último item incluido cuando hay más", () => {
    const source: TimelineItem[] = [
      item("i5", "2026-07-13T10:00:00Z"),
      item("i4", "2026-07-12T10:00:00Z"),
      item("i3", "2026-07-11T10:00:00Z"),
      item("i2", "2026-07-10T10:00:00Z"),
      item("i1", "2026-07-09T10:00:00Z"),
    ];

    const { items, nextCursor } = mergeTimeline([source], 2);

    expect(items.map((i) => i.id)).toEqual(["i5", "i4"]);
    expect(nextCursor).toBe("2026-07-12T10:00:00Z");
  });

  it("nextCursor es null cuando no hay más items después del corte", () => {
    const source: TimelineItem[] = [item("i2", "2026-07-13T10:00:00Z"), item("i1", "2026-07-12T10:00:00Z")];

    const { items, nextCursor } = mergeTimeline([source], 5);

    expect(items).toHaveLength(2);
    expect(nextCursor).toBeNull();
  });

  it("filtra items con ts >= before (cursor exclusivo)", () => {
    const source: TimelineItem[] = [
      item("i3", "2026-07-13T10:00:00Z"),
      item("i2", "2026-07-12T10:00:00Z"),
      item("i1", "2026-07-11T10:00:00Z"),
    ];

    const { items } = mergeTimeline([source], 10, "2026-07-12T10:00:00Z");

    expect(items.map((i) => i.id)).toEqual(["i1"]);
  });

  it("empates en ts mantienen orden estable (orden de entrada entre fuentes)", () => {
    const sourceA: TimelineItem[] = [item("a", "2026-07-13T10:00:00Z")];
    const sourceB: TimelineItem[] = [item("b", "2026-07-13T10:00:00Z")];

    const { items } = mergeTimeline([sourceA, sourceB], 10);

    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("arreglo vacío de fuentes devuelve items vacío y nextCursor null", () => {
    const { items, nextCursor } = mergeTimeline([], 10);
    expect(items).toEqual([]);
    expect(nextCursor).toBeNull();
  });
});
