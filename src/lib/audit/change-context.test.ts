import { describe, it, expect, vi, beforeEach } from "vitest";

const executeRaw = vi.fn((..._args: unknown[]) => undefined);
const transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({ $executeRaw: (...a: unknown[]) => executeRaw(...a) })
);

vi.mock("@/lib/db", () => ({ default: { $transaction: (fn: (tx: unknown) => unknown) => transaction(fn) } }));

import { withChangeSource, setChangeSource } from "./change-context";

beforeEach(() => {
  executeRaw.mockReset();
  transaction.mockClear();
});

describe("withChangeSource", () => {
  it("abre una transacción y corre fn con el cliente transaccional", async () => {
    const result = await withChangeSource({ source: "ui", actorId: "u1" }, async (tx) => {
      expect(tx).toBeDefined();
      return "ok";
    });
    expect(result).toBe("ok");
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("fija crm.source y crm.actor_id vía set_config antes de correr fn", async () => {
    await withChangeSource({ source: "workflow", actorId: "u2" }, async () => null);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [strings, source, actorId] = executeRaw.mock.calls[0] as [string[], string, string];
    expect(strings.join("")).toContain("set_config");
    expect(source).toBe("workflow");
    expect(actorId).toBe("u2");
  });

  it("usa '' cuando actorId es null/undefined (nullif en el trigger lo vuelve NULL)", async () => {
    await withChangeSource({ source: "zapier" }, async () => null);
    const [, , actorId] = executeRaw.mock.calls[0];
    expect(actorId).toBe("");
  });

  it("propaga (no traga) un error lanzado por fn", async () => {
    await expect(
      withChangeSource({ source: "ui" }, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });
});

describe("setChangeSource", () => {
  it("ejecuta set_config sobre la tx recibida SIN abrir una transacción nueva", async () => {
    const tx = { $executeRaw: (...a: unknown[]) => executeRaw(...a) } as never;
    await setChangeSource(tx, { source: "merge", actorId: "u3" });
    expect(transaction).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [, source, actorId] = executeRaw.mock.calls[0];
    expect(source).toBe("merge");
    expect(actorId).toBe("u3");
  });
});
