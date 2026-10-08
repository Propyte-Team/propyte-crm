import { describe, it, expect, vi, beforeEach } from "vitest";

const executeRaw = vi.fn();
const transaction = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    $transaction: (...a: unknown[]) => transaction(...a),
    marca: "prisma-global",
  },
}));

import { withIntakeLock, intakeLockKey } from "./intake-lock";

beforeEach(() => {
  vi.resetAllMocks();
  executeRaw.mockResolvedValue(1);
  // transacción falsa: entrega un `tx` identificable y respeta el valor de retorno
  transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ $executeRaw: executeRaw, marca: "tx" }),
  );
});

describe("withIntakeLock", () => {
  it("toma el advisory lock transaccional con el prefijo y entrega el cliente de la TRANSACCIÓN a fn", async () => {
    const visto = vi.fn(async (db: { marca?: string }) => db.marca);

    const r = await withIntakeLock("+529841364211", visto as never);

    expect(r).toBe("tx"); // fn recibió el tx, no el prisma global (un pool chico se atoraría)
    expect(executeRaw).toHaveBeenCalledTimes(1);
    // template tag: [strings[], ...valores] — el valor lleva el prefijo del candado
    expect(executeRaw.mock.calls[0].slice(1)).toEqual(["contact-intake:+529841364211"]);
    expect(executeRaw.mock.calls[0][0].join("?")).toContain("pg_advisory_xact_lock(hashtextextended(");
  });

  it("acota la espera y la duración de la transacción", async () => {
    await withIntakeLock("k", (async () => 1) as never);
    expect(transaction.mock.calls[0][1]).toEqual({ maxWait: 5000, timeout: 15000 });
  });

  it("sin llave (nada con qué deduplicar) corre directo, sin transacción ni candado", async () => {
    const visto = vi.fn(async (db: { marca?: string }) => db.marca);

    const r = await withIntakeLock(null, visto as never);

    expect(r).toBe("prisma-global");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("si fn falla, el error se propaga (el candado lo suelta la transacción al abortar)", async () => {
    await expect(withIntakeLock("k", (async () => { throw new Error("boom"); }) as never)).rejects.toThrow("boom");
  });
});

describe("intakeLockKey", () => {
  it("usa el primer identificador que exista: teléfono > psid > instagram > correo", () => {
    expect(intakeLockKey({ phone: "+52", email: "a@b.c" })).toBe("+52");
    expect(intakeLockKey({ messengerPsid: "ps", instagramId: "ig", email: "a@b.c" })).toBe("ps");
    expect(intakeLockKey({ instagramId: "ig", email: "a@b.c" })).toBe("ig");
    expect(intakeLockKey({ email: "a@b.c" })).toBe("a@b.c");
  });
  it("sin identificadores → null", () => {
    expect(intakeLockKey({})).toBeNull();
    expect(intakeLockKey({ phone: "", email: null })).toBeNull();
  });
});
