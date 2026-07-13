import type { TimelineItem } from "./types";

// Merge-sort descendente por ts de N fuentes ya ordenadas, con cursor de paginación.
// `before` es exclusivo: solo se incluyen items con ts < before. `Array.prototype.sort`
// es estable (ES2019+), así que los empates conservan el orden de entrada (útil cuando
// dos fuentes distintas comparten el mismo instante).
export function mergeTimeline(
  sources: TimelineItem[][],
  limit: number,
  before?: string
): { items: TimelineItem[]; nextCursor: string | null } {
  const beforeMs = before ? new Date(before).getTime() : null;

  const all = sources.flat();
  const filtered =
    beforeMs !== null ? all.filter((it) => new Date(it.ts).getTime() < beforeMs) : all;

  filtered.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  const items = filtered.slice(0, limit);
  const nextCursor = filtered.length > limit ? items[items.length - 1].ts : null;

  return { items, nextCursor };
}
