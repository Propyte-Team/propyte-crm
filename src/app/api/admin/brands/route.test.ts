// GET/POST /api/admin/brands (2026-10-09): lectura para el equipo de conexiones (incluye
// MARKETING), escritura solo para quien configura el bot. isDefault nunca viene del cliente.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const session: { user: { id: string; role: string } } = { user: { id: "u1", role: "GERENTE" } };
let hasSession = true;
vi.mock("@/lib/auth/session", () => ({
  getServerSession: () => Promise.resolve(hasSession ? session : null),
}));

const brandFindMany = vi.fn();
const brandCreate = vi.fn();
const playbookFindFirst = vi.fn();
const userFindFirst = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    brand: {
      findMany: (...a: unknown[]) => brandFindMany(...a),
      create: (...a: unknown[]) => brandCreate(...a),
    },
    botPlaybook: { findFirst: (...a: unknown[]) => playbookFindFirst(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { GET, POST } from "./route";

const UUID_PB = "3f2b8c1e-5d4a-4b6f-9c7e-1a2b3c4d5e6f";
const UUID_USER = "9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

function req(body: unknown) {
  return new Request("http://t/api/admin/brands", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;
}

const VALID = { name: "Nativa Tulum", slug: "nativa-tulum" };

beforeEach(() => {
  for (const m of [brandFindMany, brandCreate, playbookFindFirst, userFindFirst, auditCreate]) m.mockReset();
  hasSession = true;
  session.user.role = "GERENTE";
  brandFindMany.mockResolvedValue([]);
  brandCreate.mockResolvedValue({ id: "b1", name: "Nativa Tulum", slug: "nativa-tulum", isDefault: false });
  playbookFindFirst.mockResolvedValue({ id: UUID_PB });
  userFindFirst.mockResolvedValue({ id: UUID_USER });
  auditCreate.mockResolvedValue({});
});

describe("GET /api/admin/brands", () => {
  it("sin sesión → 403", async () => {
    hasSession = false;
    expect((await GET()).status).toBe(403);
    expect(brandFindMany).not.toHaveBeenCalled();
  });

  it("con rol ASESOR → 403", async () => {
    session.user.role = "ASESOR";
    expect((await GET()).status).toBe(403);
    expect(brandFindMany).not.toHaveBeenCalled();
  });

  it("MARKETING lee: marcas no borradas, predeterminada primero y luego por nombre, con sus cuentas vivas", async () => {
    session.user.role = "MARKETING";
    const rows = [{ id: "b0", name: "Propyte", isDefault: true, connectors: [] }];
    brandFindMany.mockResolvedValue(rows);

    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(rows);

    const arg = brandFindMany.mock.calls[0][0];
    expect(arg.where).toEqual({ deletedAt: null });
    expect(arg.orderBy).toEqual([{ isDefault: "desc" }, { name: "asc" }]);
    expect(arg.include.connectors).toEqual({
      where: { deletedAt: null },
      select: { id: true, name: true, provider: true, status: true },
    });
  });

  it("tabla inexistente (P2021: migración sin aplicar) → 200 con lista vacía", async () => {
    brandFindMany.mockRejectedValue({ code: "P2021" });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  it("otro error de base → 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    brandFindMany.mockRejectedValue(new Error("boom"));
    expect((await GET()).status).toBe(500);
  });
});

describe("POST /api/admin/brands", () => {
  it("sin sesión → 403", async () => {
    hasSession = false;
    expect((await POST(req(VALID))).status).toBe(403);
    expect(brandCreate).not.toHaveBeenCalled();
  });

  it("con rol ASESOR → 403", async () => {
    session.user.role = "ASESOR";
    expect((await POST(req(VALID))).status).toBe(403);
    expect(brandCreate).not.toHaveBeenCalled();
  });

  it("MARKETING puede leer pero no crear → 403", async () => {
    session.user.role = "MARKETING";
    expect((await POST(req(VALID))).status).toBe(403);
    expect(brandCreate).not.toHaveBeenCalled();
  });

  it("GERENTE con cuerpo válido → 201, crea con isDefault:false y escribe auditLog", async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    expect((await res.json()).data.id).toBe("b1");

    const data = brandCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: "Nativa Tulum", slug: "nativa-tulum", isDefault: false });
    expect(data.botEnabled).toBe(false);

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      userId: "u1",
      action: "CREATE",
      entity: "Brand",
      entityId: "b1",
    });
  });

  it("isDefault en el cuerpo se rechaza (400) y no se crea nada", async () => {
    const res = await POST(req({ ...VALID, isDefault: true }));
    expect(res.status).toBe(400);
    expect(brandCreate).not.toHaveBeenCalled();
  });

  it("cuerpo inválido (slug con mayúsculas) → 400", async () => {
    const res = await POST(req({ ...VALID, slug: "Nativa Tulum" }));
    expect(res.status).toBe(400);
    expect(brandCreate).not.toHaveBeenCalled();
  });

  it("enabledChannels null se guarda como Prisma.DbNull y un arreglo se guarda tal cual", async () => {
    await POST(req({ ...VALID, enabledChannels: null }));
    expect(brandCreate.mock.calls[0][0].data.enabledChannels).toBe(Prisma.DbNull);

    await POST(req({ ...VALID, enabledChannels: ["WHATSAPP", "INSTAGRAM"] }));
    expect(brandCreate.mock.calls[1][0].data.enabledChannels).toEqual(["WHATSAPP", "INSTAGRAM"]);
  });

  it("sin enabledChannels en el cuerpo no se toca la columna (hereda la config global)", async () => {
    await POST(req(VALID));
    expect("enabledChannels" in brandCreate.mock.calls[0][0].data).toBe(false);
  });

  it("slug o name repetido (Prisma P2002) → 409", async () => {
    brandCreate.mockRejectedValue({ code: "P2002" });
    const res = await POST(req(VALID));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/nombre o ese slug/);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("playbookId inexistente o borrado → 400", async () => {
    playbookFindFirst.mockResolvedValue(null);
    const res = await POST(req({ ...VALID, playbookId: UUID_PB }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Playbook no encontrado");
    expect(playbookFindFirst.mock.calls[0][0].where).toEqual({ id: UUID_PB, deletedAt: null });
    expect(brandCreate).not.toHaveBeenCalled();
  });

  it("marketingOwnerUserId de un usuario inactivo (o inexistente) → 400", async () => {
    userFindFirst.mockResolvedValue(null);
    const res = await POST(req({ ...VALID, marketingOwnerUserId: UUID_USER }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Responsable de marketing/);
    expect(userFindFirst.mock.calls[0][0].where).toEqual({ id: UUID_USER, isActive: true, deletedAt: null });
    expect(brandCreate).not.toHaveBeenCalled();
  });

  it("playbook y responsable válidos se verifican y se guardan", async () => {
    const res = await POST(req({ ...VALID, playbookId: UUID_PB, marketingOwnerUserId: UUID_USER }));
    expect(res.status).toBe(201);
    expect(brandCreate.mock.calls[0][0].data).toMatchObject({
      playbookId: UUID_PB,
      marketingOwnerUserId: UUID_USER,
    });
  });

  it("playbookId null no consulta nada y se guarda null", async () => {
    await POST(req({ ...VALID, playbookId: null, marketingOwnerUserId: null }));
    expect(playbookFindFirst).not.toHaveBeenCalled();
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(brandCreate.mock.calls[0][0].data).toMatchObject({ playbookId: null, marketingOwnerUserId: null });
  });
});
