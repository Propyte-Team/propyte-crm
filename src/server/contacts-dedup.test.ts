import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ default: { contact: { findMany: (...a: unknown[]) => findMany(...a) } } }));

import { findDuplicateGroups } from "./contacts-dedup";

// Cuerpo de bloque: una flecha que devuelve el mock lo registra como limpieza (#808).
beforeEach(() => {
  findMany.mockReset();
});

const base = { createdAt: new Date(), assignedTo: null, instagramId: null, messengerPsid: null, _count: { deals: 0, activities: 0 } };

describe("findDuplicateGroups", () => {
  it("incluye instagramId/messengerPsid en el select de contactos", async () => {
    findMany.mockResolvedValue([]);
    await findDuplicateGroups();
    const select = findMany.mock.calls[0][0].select;
    expect(select.instagramId).toBe(true);
    expect(select.messengerPsid).toBe(true);
  });

  it("mapea grupos con matchType y ordena strong antes que name", async () => {
    findMany.mockResolvedValue([
      { id: "1", firstName: "Carlos", lastName: "Ruiz", email: "a@x.com", phone: "111", ...base },
      { id: "2", firstName: "Carlos", lastName: "Ruiz", email: "b@y.com", phone: "222", ...base },
      { id: "3", firstName: "Ana", lastName: "López", email: "c@z.com", phone: "333", ...base },
      { id: "4", firstName: "Ana", lastName: "López", email: "c@z.com", phone: "444", ...base },
    ]);
    const groups = await findDuplicateGroups();
    expect(groups).toHaveLength(2);
    expect(groups[0].matchType).toBe("strong"); // 3,4 comparten email → strong
    expect(groups[1].matchType).toBe("name"); // 1,2 solo comparten nombre
    expect(groups[0].contacts.map((c) => c.id).sort()).toEqual(["3", "4"]);
  });
});

describe("mergeContacts — emite contact.merged", () => {
  it("tras fusionar emite con el contacto que sobrevive; si falla la fusión, no emite", async () => {
    vi.resetModules();
    const emitirContactoFusionado = vi.fn();
    const tx = {
      contact: { findFirst: vi.fn().mockResolvedValue({ id: "x", email: null, createdAt: new Date() }), update: vi.fn() },
      systemConfig: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
      $executeRawUnsafe: vi.fn(), $executeRaw: vi.fn(),
    } as Record<string, unknown>;
    for (const r of ["deal", "activity", "walkIn", "message", "slaTimer", "connectorLeadLog", "conversionEvent", "shortlist", "contactFile", "contactDossier", "adAttribution", "webBehavior", "conversation"]) {
      tx[r] = { updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(1) };
    }
    vi.doMock("@/lib/db", () => ({ default: { $transaction: (fn: (t: unknown) => unknown) => fn(tx) } }));
    vi.doMock("@/lib/audit/change-context", () => ({ setChangeSource: vi.fn() }));
    vi.doMock("@/lib/workflows/emisiones", () => ({ emitirContactoFusionado }));
    const { mergeContacts } = await import("./contacts-dedup");

    const ok = await mergeContacts({ survivorId: "s", loserId: "l" });
    expect(ok).toEqual({ survivorId: "s" });
    expect(emitirContactoFusionado).toHaveBeenCalledWith("s", "l");

    emitirContactoFusionado.mockClear();
    (tx.contact as { findFirst: ReturnType<typeof vi.fn> }).findFirst.mockResolvedValue(null);
    expect(await mergeContacts({ survivorId: "s", loserId: "l" })).toHaveProperty("error");
    expect(emitirContactoFusionado).not.toHaveBeenCalled();
  });
});
