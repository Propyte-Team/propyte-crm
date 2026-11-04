import { describe, it, expect, vi } from "vitest";
import { CLAVE_FUSIONES, MAX_FUSIONES, agregarFusion, deshacerFusionTx, leerFusiones, registrarFusion, type RegistroFusion, type TxDeshacer } from "./fusiones";

const reg = (over: Partial<RegistroFusion> = {}): RegistroFusion => ({
  id: "f1", fecha: "2026-11-04T10:00:00.000Z", actorId: "u1",
  survivorId: "S", loserId: "L", survivorNombre: "Ana Pérez", loserNombre: "Ana P.",
  movidas: { deal: ["d1", "d2"], message: ["m1"] },
  movidasUno: { contactDossier: ["x1"] },
  campos: { email: { antes: null, despues: "a@x.com" } },
  ...over,
});

function mkTx(opts: { registros?: RegistroFusion[]; survivor?: Record<string, unknown>; loser?: Record<string, unknown>; dossierLoser?: number; ocupados?: string[] } = {}) {
  const estado = { value: opts.registros ?? [reg()] as unknown };
  const calls: Array<[string, string, unknown]> = [];
  const contacts: Record<string, Record<string, unknown>> = {
    S: opts.survivor ?? { id: "S", deletedAt: null, mergedIntoId: null, email: "a@x.com" },
    L: opts.loser ?? { id: "L", deletedAt: new Date(), mergedIntoId: "S" },
  };
  const deleg = (nombre: string) => ({
    updateMany: vi.fn(async (a: unknown) => { calls.push([nombre, "updateMany", a]); return { count: 1 }; }),
    count: vi.fn(async () => opts.dossierLoser ?? 0),
  });
  const tx = {
    systemConfig: {
      findUnique: vi.fn(async () => ({ value: estado.value })),
      upsert: vi.fn(async (a: { update: { value: unknown } }) => { estado.value = a.update.value; }),
    },
    contact: {
      findUnique: vi.fn(async (a: { where: { id: string } }) => contacts[a.where.id] ?? null),
      findFirst: vi.fn(async (a: { where: Record<string, unknown> }) =>
        Object.values(a.where).some((v) => typeof v === "string" && (opts.ocupados ?? []).includes(v)) ? { id: "X" } : null),
      update: vi.fn(async (a: unknown) => { calls.push(["contact", "update", a]); }),
    },
    deal: deleg("deal"), message: deleg("message"), contactDossier: deleg("contactDossier"),
  } as unknown as TxDeshacer;
  return { tx, estado, calls };
}

describe("registro de fusiones", () => {
  it("agrega al inicio y acota a MAX_FUSIONES", () => {
    const lista = Array.from({ length: MAX_FUSIONES }, (_, i) => reg({ id: `r${i}` }));
    const nueva = agregarFusion(lista, reg({ id: "nuevo" }));
    expect(nueva).toHaveLength(MAX_FUSIONES);
    expect(nueva[0].id).toBe("nuevo");
  });
  it("leerFusiones ignora basura", () => {
    expect(leerFusiones(null)).toEqual([]);
    expect(leerFusiones([reg(), { x: 1 }, 5])).toHaveLength(1);
  });
  it("registrarFusion persiste en la clave contacts.fusiones", async () => {
    const { tx, estado } = mkTx({ registros: [] });
    await registrarFusion(tx, reg());
    expect((tx.systemConfig.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0].where.key).toBe(CLAVE_FUSIONES);
    expect(leerFusiones(estado.value)[0].id).toBe("f1");
  });
});

describe("deshacerFusionTx", () => {
  it("devuelve relaciones, revierte campo, restaura al perdedor y marca el registro", async () => {
    const { tx, estado, calls } = mkTx();
    const r = await deshacerFusionTx(tx, "f1");
    expect(r).toEqual({ ok: true, loserId: "L", survivorId: "S", idsNoDevueltos: [] });
    const dealCall = calls.find((c) => c[0] === "deal")![2] as { where: unknown; data: unknown };
    expect(dealCall).toEqual({ where: { id: { in: ["d1", "d2"] }, contactId: "S" }, data: { contactId: "L" } });
    expect(calls.some((c) => c[0] === "contactDossier")).toBe(true);
    const updates = calls.filter((c) => c[0] === "contact").map((c) => c[2]);
    expect(updates).toContainEqual({ where: { id: "S" }, data: { email: null } });
    expect(updates).toContainEqual({ where: { id: "L" }, data: { deletedAt: null, mergedIntoId: null } });
    expect(leerFusiones(estado.value)[0].deshechaEn).toBeTruthy();
  });
  it("#903: quita al ganador el id de canal que recibió y se lo devuelve al perdedor", async () => {
    const r0 = reg({
      campos: { instagramId: { antes: null, despues: "ig-1" } },
      idsCanalArchivado: { instagramId: "ig-1", messengerPsid: "psid-1" },
    });
    const { tx, calls } = mkTx({ registros: [r0], survivor: { id: "S", deletedAt: null, instagramId: "ig-1" }, ocupados: ["psid-1"] });
    const r = await deshacerFusionTx(tx, "f1");
    expect(r).toMatchObject({ ok: true, idsNoDevueltos: ["messengerPsid"] });
    const updates = calls.filter((c) => c[0] === "contact").map((c) => c[2]);
    const iS = updates.findIndex((u) => JSON.stringify(u) === JSON.stringify({ where: { id: "S" }, data: { instagramId: null } }));
    const iL = updates.findIndex((u) => JSON.stringify(u) === JSON.stringify({ where: { id: "L" }, data: { deletedAt: null, mergedIntoId: null, instagramId: "ig-1" } }));
    expect(iS).toBeGreaterThanOrEqual(0);
    expect(iL).toBeGreaterThan(iS);
  });
  it("no pisa un campo que el ganador ya cambió", async () => {
    const { tx, calls } = mkTx({ survivor: { id: "S", deletedAt: null, email: "otro@x.com" } });
    await deshacerFusionTx(tx, "f1");
    const updates = calls.filter((c) => c[0] === "contact").map((c) => c[2]);
    expect(updates).not.toContainEqual({ where: { id: "S" }, data: { email: null } });
  });
  it("no devuelve el 1-a-1 si el perdedor ya tiene uno", async () => {
    const { tx, calls } = mkTx({ dossierLoser: 1 });
    await deshacerFusionTx(tx, "f1");
    expect(calls.some((c) => c[0] === "contactDossier")).toBe(false);
  });
  it("errores claros: sin registro, ya deshecha, perdedor restaurado, ganador archivado", async () => {
    expect(await deshacerFusionTx(mkTx().tx, "nope")).toMatchObject({ status: 404 });
    expect(await deshacerFusionTx(mkTx({ registros: [reg({ deshechaEn: "2026-11-05" })] }).tx, "f1")).toMatchObject({ status: 409, error: "Esa fusión ya se deshizo" });
    expect(await deshacerFusionTx(mkTx({ loser: { id: "L", deletedAt: null, mergedIntoId: null } }).tx, "f1")).toMatchObject({ status: 409 });
    expect(await deshacerFusionTx(mkTx({ survivor: { id: "S", deletedAt: new Date() } }).tx, "f1")).toMatchObject({ status: 409 });
  });
});
