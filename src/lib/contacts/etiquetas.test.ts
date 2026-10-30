import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const findMany = vi.fn();
const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contactTag: {
      findMany: (...a: unknown[]) => findMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import { crearEtiqueta, resolverEtiquetas } from "./etiquetas";

const CATALOGO = [
  { name: "LEAD FRIO", nameKey: "lead frio" },
  { name: "HOT", nameKey: "hot" },
];

beforeEach(() => {
  [findMany, findUnique, create, update].forEach((m) => m.mockReset());
  findMany.mockImplementation(async (args: { where: { nameKey: { in: string[] } } }) =>
    CATALOGO.filter((c) => args.where.nameKey.in.includes(c.nameKey)),
  );
});

describe("resolverEtiquetas (#936)", () => {
  it("traduce a como está escrita en el catálogo y quita repetidas", async () => {
    const r = await resolverEtiquetas(["lead frío", "HOT", "Lead Frio", " hot "], []);
    expect(r).toEqual({ ok: true, tags: ["LEAD FRIO", "HOT"] });
    // Solo pide las sin archivar.
    expect(findMany.mock.calls[0][0].where.archivedAt).toBeNull();
  });

  it("una etiqueta que no está en el catálogo: error con su nombre", async () => {
    const r = await resolverEtiquetas(["HOT", "Tulum"], []);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.etiqueta).toBe("Tulum");
      expect(r.error).toContain("«Tulum» no existe");
    }
  });

  it("las que el contacto YA tenía se respetan aunque no estén en el catálogo (p. ej. SPAM)", async () => {
    const r = await resolverEtiquetas(["SPAM", "hot"], ["SPAM"]);
    expect(r).toEqual({ ok: true, tags: ["SPAM", "HOT"] });
  });

  it("lista vacía o solo espacios: [] sin tocar la base", async () => {
    expect(await resolverEtiquetas(["  ", ""], ["X"])).toEqual({ ok: true, tags: [] });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("crearEtiqueta (#936 «Crear +»)", () => {
  it("nueva: guarda nombre limpio y clave, con quién la creó", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "t1", name: "Preventa Tulum" });
    const r = await crearEtiqueta("  Preventa   Tulum ", "u1");
    expect(r).toEqual({ ok: true, creada: true, data: { id: "t1", name: "Preventa Tulum" } });
    expect(create.mock.calls[0][0].data).toEqual({ name: "Preventa Tulum", nameKey: "preventa tulum", createdById: "u1" });
  });

  it("ya existía con otra escritura: devuelve la existente, sin crear", async () => {
    findUnique.mockResolvedValue({ id: "t9", name: "LEAD FRIO", archivedAt: null });
    const r = await crearEtiqueta("lead frío", "u1");
    expect(r).toEqual({ ok: true, creada: false, data: { id: "t9", name: "LEAD FRIO" } });
    expect(create).not.toHaveBeenCalled();
  });

  it("existía archivada: se desarchiva y se devuelve", async () => {
    findUnique.mockResolvedValue({ id: "t9", name: "HOT", archivedAt: new Date() });
    await crearEtiqueta("hot", "u1");
    expect(update).toHaveBeenCalledWith({ where: { id: "t9" }, data: { archivedAt: null } });
  });

  it("vacía o demasiado larga: error sin tocar la base", async () => {
    expect((await crearEtiqueta("   ", "u1")).ok).toBe(false);
    expect((await crearEtiqueta("x".repeat(51), "u1")).ok).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("carrera (P2002): devuelve la que ganó", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "t2", name: "VIP" });
    create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    expect(await crearEtiqueta("VIP", "u1")).toEqual({ ok: true, creada: false, data: { id: "t2", name: "VIP" } });
  });
});
