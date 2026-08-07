import { describe, it, expect, vi } from "vitest";
import { ASSET_SCOPES, ASSET_SCOPE_KEYS } from "./asset-scopes";

// Cliente falso: cada modelo registra con qué argumentos lo llamaron.
function fakeTx() {
  const calls: Record<string, unknown[]> = {};
  const model = (name: string) => ({
    count: vi.fn(async (args: unknown) => {
      calls[`${name}.count`] = [args];
      return 7;
    }),
    updateMany: vi.fn(async (args: unknown) => {
      calls[`${name}.updateMany`] = [args];
      return { count: 3 };
    }),
  });
  return {
    calls,
    tx: {
      contact: model("contact"),
      deal: model("deal"),
      conversation: model("conversation"),
      unit: model("unit"),
      walkIn: model("walkIn"),
      quote: model("quote"),
    },
  };
}

describe("ASSET_SCOPES", () => {
  it("expone exactamente los 6 scopes acordados", () => {
    expect(ASSET_SCOPE_KEYS).toEqual([
      "contacts",
      "deals",
      "conversations",
      "units",
      "walkins",
      "quotes",
    ]);
  });

  it("cuenta contactos vivos del usuario", async () => {
    const { tx, calls } = fakeTx();
    const n = await ASSET_SCOPES.contacts.count(tx as never, "u1");
    expect(n).toBe(7);
    expect(calls["contact.count"][0]).toEqual({
      where: { assignedToId: "u1", deletedAt: null },
    });
  });

  it("mueve contactos vivos de un usuario a otro", async () => {
    const { tx, calls } = fakeTx();
    const n = await ASSET_SCOPES.contacts.move(tx as never, "u1", "u2");
    expect(n).toBe(3);
    expect(calls["contact.updateMany"][0]).toEqual({
      where: { assignedToId: "u1", deletedAt: null },
      data: { assignedToId: "u2" },
    });
  });

  it("las conversaciones no filtran deletedAt: el modelo no tiene esa columna", async () => {
    const { tx, calls } = fakeTx();
    await ASSET_SCOPES.conversations.move(tx as never, "u1", "u2");
    expect(calls["conversation.updateMany"][0]).toEqual({
      where: { controlledById: "u1" },
      data: { controlledById: "u2" },
    });
  });

  it("walk-ins mueve al asesor asignado y NO toca hostessId", async () => {
    const { tx, calls } = fakeTx();
    await ASSET_SCOPES.walkins.move(tx as never, "u1", "u2");
    const args = calls["walkIn.updateMany"][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(args.where).toEqual({ assignedAdvisorId: "u1", deletedAt: null });
    expect(args.data).toEqual({ assignedAdvisorId: "u2" });
    expect(Object.keys(args.data)).not.toContain("hostessId");
    expect(Object.keys(args.where)).not.toContain("hostessId");
  });

  it("unidades mueve reservedByUserId y NO toca reservedByContactId", async () => {
    const { tx, calls } = fakeTx();
    await ASSET_SCOPES.units.move(tx as never, "u1", "u2");
    const args = calls["unit.updateMany"][0] as { data: Record<string, unknown> };
    expect(args.data).toEqual({ reservedByUserId: "u2" });
    expect(Object.keys(args.data)).not.toContain("reservedByContactId");
  });
});
