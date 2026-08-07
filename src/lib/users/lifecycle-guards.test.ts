import { describe, it, expect, vi } from "vitest";
import {
  assertNotSelf,
  assertNotLastAdmin,
  assertNoDependents,
  assertNoLiveAssets,
  assertValidTarget,
} from "./lifecycle-guards";

function txWith(overrides: {
  target?: Record<string, unknown> | null;
  adminCount?: number;
  members?: Array<{ name: string }>;
  teams?: Array<{ name: string }>;
  territories?: number;
}) {
  return {
    user: {
      findUnique: vi.fn(async () =>
        overrides.target === undefined
          ? { id: "u1", role: "ASESOR_JR", name: "Ana", isActive: true, deletedAt: null }
          : overrides.target,
      ),
      count: vi.fn(async () => overrides.adminCount ?? 3),
      findMany: vi.fn(async () => overrides.members ?? []),
    },
    team: { findMany: vi.fn(async () => overrides.teams ?? []) },
    territoryMember: { count: vi.fn(async () => overrides.territories ?? 0) },
  } as never;
}

/** Cliente falso donde cada scope de activos devuelve el conteo que le pidas. */
function txWithAssets(counts: Partial<Record<string, number>>) {
  const model = (name: string) => ({
    count: vi.fn(async () => counts[name] ?? 0),
  });
  return {
    contact: model("contact"),
    deal: model("deal"),
    conversation: model("conversation"),
    unit: model("unit"),
    walkIn: model("walkIn"),
    quote: model("quote"),
  } as never;
}

describe("assertNoLiveAssets", () => {
  it("permite cuando el usuario no tiene nada asignado", async () => {
    await expect(assertNoLiveAssets(txWithAssets({}), "u1")).resolves.toBeUndefined();
  });

  it("rechaza y dice cuántos contactos tiene", async () => {
    await expect(
      assertNoLiveAssets(txWithAssets({ contact: 30 }), "u1"),
    ).rejects.toThrow(/30 Contactos/);
  });

  it("nombra todos los scopes con algo, no solo el primero", async () => {
    const error = await assertNoLiveAssets(
      txWithAssets({ contact: 30, deal: 5, quote: 2 }),
      "u1",
    ).catch((e: Error) => e);

    expect((error as Error).message).toMatch(/30 Contactos/);
    expect((error as Error).message).toMatch(/5 Negocios/);
    expect((error as Error).message).toMatch(/2 Cotizaciones/);
  });

  it("no menciona los scopes que están en cero", async () => {
    const error = await assertNoLiveAssets(txWithAssets({ contact: 3 }), "u1").catch(
      (e: Error) => e,
    );

    expect((error as Error).message).not.toMatch(/Negocios/);
    expect((error as Error).message).not.toMatch(/Walk-ins/);
  });

  it("detecta un scope que no es cartera comercial, como conversaciones", async () => {
    await expect(
      assertNoLiveAssets(txWithAssets({ conversation: 1 }), "u1"),
    ).rejects.toThrow(/Conversaciones del inbox/);
  });
});

describe("assertNotSelf", () => {
  it("rechaza actuar sobre la propia cuenta", () => {
    expect(() => assertNotSelf("u1", "u1")).toThrow(/tu propia cuenta/);
  });

  it("permite actuar sobre otra cuenta", () => {
    expect(() => assertNotSelf("u1", "u2")).not.toThrow();
  });
});

describe("assertNotLastAdmin", () => {
  it("rechaza si es el último ADMIN o DIRECTOR activo", async () => {
    const tx = txWith({ target: { role: "DIRECTOR" }, adminCount: 0 });
    await expect(assertNotLastAdmin(tx, "u1")).rejects.toThrow(
      /sin administradores activos/,
    );
  });

  it("permite si queda otro administrador activo", async () => {
    const tx = txWith({ target: { role: "DIRECTOR" }, adminCount: 1 });
    await expect(assertNotLastAdmin(tx, "u1")).resolves.toBeUndefined();
  });

  it("no aplica a roles que no son administradores", async () => {
    const tx = txWith({ target: { role: "ASESOR_JR" }, adminCount: 0 });
    await expect(assertNotLastAdmin(tx, "u1")).resolves.toBeUndefined();
  });
});

describe("assertNoDependents", () => {
  it("rechaza y nombra a los subordinados", async () => {
    const tx = txWith({ members: [{ name: "Ana" }, { name: "Beto" }] });
    await expect(assertNoDependents(tx, "u1")).rejects.toThrow(/Ana, Beto/);
  });

  it("rechaza y nombra los equipos que lidera", async () => {
    const tx = txWith({ teams: [{ name: "Tulum A" }] });
    await expect(assertNoDependents(tx, "u1")).rejects.toThrow(/Tulum A/);
  });

  it("rechaza si tiene membresías de territorio", async () => {
    const tx = txWith({ territories: 2 });
    await expect(assertNoDependents(tx, "u1")).rejects.toThrow(/territorio/);
  });

  it("permite cuando no tiene nada colgando", async () => {
    await expect(assertNoDependents(txWith({}), "u1")).resolves.toBeUndefined();
  });
});

describe("assertValidTarget (destino de una reasignación)", () => {
  it("rechaza un destino igual al origen", async () => {
    await expect(assertValidTarget(txWith({}), "u1", "u1")).rejects.toThrow(
      /mismo usuario/,
    );
  });

  it("rechaza un destino inexistente", async () => {
    const tx = txWith({ target: null });
    await expect(assertValidTarget(tx, "u1", "u2")).rejects.toThrow(
      /no existe/,
    );
  });

  it("rechaza un destino que no está activo", async () => {
    const tx = txWith({
      target: { id: "u2", name: "Beto", isActive: false, deletedAt: null, plaza: "TULUM" },
    });
    await expect(assertValidTarget(tx, "u1", "u2")).rejects.toThrow(/activo/);
  });

  it("acepta un destino activo", async () => {
    const tx = txWith({
      target: { id: "u2", name: "Beto", isActive: true, deletedAt: null, plaza: "TULUM" },
    });
    await expect(assertValidTarget(tx, "u1", "u2")).resolves.toBeUndefined();
  });
});
