import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const contact = vi.fn();
const findMany = vi.fn();
const timerFindFirst = vi.fn();
const timerCreate = vi.fn();
const contactUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contact(...a), update: (...a: unknown[]) => contactUpdate(...a) },
    slaPolicy: { findMany: (...a: unknown[]) => findMany(...a) },
    slaTimer: { findFirst: (...a: unknown[]) => timerFindFirst(...a), create: (...a: unknown[]) => timerCreate(...a) },
  },
}));

import { createSlaTimer } from "./sla";

const NOW = new Date("2026-07-09T20:00:00Z"); // jueves 15:00 Cancún

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  contact.mockReset(); findMany.mockReset(); timerFindFirst.mockReset(); timerCreate.mockReset(); contactUpdate.mockReset();
  timerFindFirst.mockResolvedValue(null);
  timerCreate.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

const seg = { id: "seg", name: "Broker", isActive: true, isDefault: false, priority: 10,
  conditions: { all: [{ field: "contact.contactType", op: "eq", value: "BROKER_EXTERNO" }] },
  firstTouchMinutes: 15, retryMinutes: 60, orphanHours: 48, businessHours: {} };
const def = { id: "def", name: "Default", isActive: true, isDefault: true, priority: 999,
  conditions: {}, firstTouchMinutes: 5, retryMinutes: 30, orphanHours: 24, businessHours: {} };

describe("createSlaTimer", () => {
  it("elige la política del segmento y usa sus minutos", async () => {
    contact.mockResolvedValue({ id: "c1", contactType: "BROKER_EXTERNO", adAttribution: null, assignedTo: { plaza: "TULUM" } });
    findMany.mockResolvedValue([def, seg]);
    await createSlaTimer("c1", "FIRST_TOUCH");
    const data = timerCreate.mock.calls[0][0].data;
    expect(data.policyId).toBe("seg");
    expect(data.dueAt.getTime()).toBe(NOW.getTime() + 15 * 60000);
  });
  it("regresión: default sin condiciones/horario == comportamiento actual (wall-clock)", async () => {
    contact.mockResolvedValue({ id: "c1", contactType: "COMPRADOR", adAttribution: null, assignedTo: { plaza: "TULUM" } });
    findMany.mockResolvedValue([def]);
    await createSlaTimer("c1", "RETRY");
    const data = timerCreate.mock.calls[0][0].data;
    expect(data.policyId).toBe("def");
    expect(data.dueAt.getTime()).toBe(NOW.getTime() + 30 * 60000);
  });
  it("ORPHAN usa wall-clock aunque la política tenga horario", async () => {
    const bh = { ...def, businessHours: { tz: "America/Cancun", days: { "4": [540, 1080] } } };
    contact.mockResolvedValue({ id: "c1", contactType: "COMPRADOR", adAttribution: null, assignedTo: null });
    findMany.mockResolvedValue([bh]);
    await createSlaTimer("c1", "ORPHAN");
    const data = timerCreate.mock.calls[0][0].data;
    expect(data.dueAt.getTime()).toBe(NOW.getTime() + 24 * 60 * 60000);
  });
  it("no duplica timer RUNNING del mismo tipo", async () => {
    contact.mockResolvedValue({ id: "c1", contactType: "COMPRADOR", adAttribution: null, assignedTo: null });
    findMany.mockResolvedValue([def]);
    timerFindFirst.mockResolvedValue({ id: "existing" });
    await createSlaTimer("c1", "FIRST_TOUCH");
    expect(timerCreate).not.toHaveBeenCalled();
  });
});
