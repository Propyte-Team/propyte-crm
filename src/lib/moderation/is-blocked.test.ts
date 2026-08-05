import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { blockedSender: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

import { isSenderBlocked } from "./is-blocked";

beforeEach(() => {
  findUnique.mockReset();
});

describe("isSenderBlocked", () => {
  it("true si hay fila sin desbloquear", async () => {
    findUnique.mockResolvedValue({ unblockedAt: null });
    await expect(isSenderBlocked("INSTAGRAM", "IGSID-1")).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { channel_identifier: { channel: "INSTAGRAM", identifier: "IGSID-1" } },
      select: { unblockedAt: true },
    });
  });

  it("false si la fila ya fue desbloqueada", async () => {
    findUnique.mockResolvedValue({ unblockedAt: new Date("2026-08-05T00:00:00Z") });
    await expect(isSenderBlocked("INSTAGRAM", "IGSID-1")).resolves.toBe(false);
  });

  it("false si no hay fila", async () => {
    findUnique.mockResolvedValue(null);
    await expect(isSenderBlocked("MESSENGER", "PSID-9")).resolves.toBe(false);
  });

  it("no consulta con identificador vacío", async () => {
    await expect(isSenderBlocked("INSTAGRAM", "")).resolves.toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("false si la consulta truena — nunca bloquea la ingesta", async () => {
    findUnique.mockRejectedValue(new Error("db caída"));
    await expect(isSenderBlocked("INSTAGRAM", "IGSID-1")).resolves.toBe(false);
  });
});
