// PATCH/DELETE /api/admin/brands/[id] (2026-10-09): la marca predeterminada usa la config
// global del bot, así que solo se puede renombrar y nunca se borra.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const session: { user: { id: string; role: string } } = { user: { id: "u1", role: "GERENTE" } };
let hasSession = true;
vi.mock("@/lib/auth/session", () => ({
  getServerSession: () => Promise.resolve(hasSession ? session : null),
}));

const brandFindFirst = vi.fn();
const brandUpdate = vi.fn();
const playbookFindFirst = vi.fn();
const userFindFirst = vi.fn();
const connectorCount = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    brand: {
      findFirst: (...a: unknown[]) => brandFindFirst(...a),
      update: (...a: unknown[]) => brandUpdate(...a),
    },
    botPlaybook: { findFirst: (...a: unknown[]) => playbookFindFirst(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    leadConnector: { count: (...a: unknown[]) => connectorCount(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { PATCH, DELETE } from "./route";

const UUID_PB = "3f2b8c1e-5d4a-4b6f-9c7e-1a2b3c4d5e6f";
const props = (id = "b1") => ({ params: Promise.resolve({ id }) });
const patchReq = (body: unknown) =>
  new Request("http://t/api/admin/brands/b1", { method: "PATCH", body: JSON.stringify(body) }) as never;
const delReq = () => new Request("http://t/api/admin/brands/b1", { method: "DELETE" }) as never;

const DEFAULT_BRAND = { id: "b0", name: "Propyte", isDefault: true };
const OTHER_BRAND = { id: "b1", name: "Nativa", isDefault: false };

beforeEach(() => {
  for (const m of [brandFindFirst, brandUpdate, playbookFindFirst, userFindFirst, connectorCount, auditCreate]) {
    m.mockReset();
  }
  hasSession = true;
  session.user.role = "GERENTE";
  brandFindFirst.mockResolvedValue(OTHER_BRAND);
  brandUpdate.mockResolvedValue({ id: "b1", name: "Nativa 2", isDefault: false });
  playbookFindFirst.mockResolvedValue({ id: UUID_PB });
  userFindFirst.mockResolvedValue({ id: "u2" });
  connectorCount.mockResolvedValue(0);
  auditCreate.mockResolvedValue({});
});

describe("PATCH /api/admin/brands/[id]", () => {
  it("sin sesión, MARKETING o ASESOR → 403", async () => {
    hasSession = false;
    expect((await PATCH(patchReq({ name: "X1" }), props())).status).toBe(403);
    hasSession = true;
    for (const role of ["MARKETING", "ASESOR"]) {
      session.user.role = role;
      expect((await PATCH(patchReq({ name: "X1" }), props())).status, role).toBe(403);
    }
    expect(brandUpdate).not.toHaveBeenCalled();
  });

  it("la predeterminada solo se puede renombrar: cualquier otra clave → 400", async () => {
    brandFindFirst.mockResolvedValue(DEFAULT_BRAND);
    const res = await PATCH(patchReq({ name: "Propyte MX", persona: "otra cosa" }), props("b0"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "La marca predeterminada usa la configuración global del bot; solo se puede renombrar"
    );
    expect(brandUpdate).not.toHaveBeenCalled();
  });

  it("la predeterminada con botEnabled → 400 (no se enciende el bot por marca ahí)", async () => {
    brandFindFirst.mockResolvedValue(DEFAULT_BRAND);
    const res = await PATCH(patchReq({ botEnabled: true }), props("b0"));
    expect(res.status).toBe(400);
    expect(brandUpdate).not.toHaveBeenCalled();
  });

  it("la predeterminada sí se puede renombrar", async () => {
    brandFindFirst.mockResolvedValue(DEFAULT_BRAND);
    brandUpdate.mockResolvedValue({ ...DEFAULT_BRAND, name: "Propyte MX" });
    const res = await PATCH(patchReq({ name: "Propyte MX" }), props("b0"));
    expect(res.status).toBe(200);
    expect(brandUpdate.mock.calls[0][0].data).toEqual({ name: "Propyte MX" });
  });

  it("isDefault en el cuerpo se rechaza (400) también en marcas normales", async () => {
    const res = await PATCH(patchReq({ isDefault: true }), props());
    expect(res.status).toBe(400);
    expect(brandUpdate).not.toHaveBeenCalled();
  });

  it("marca inexistente o borrada → 404", async () => {
    brandFindFirst.mockResolvedValue(null);
    const res = await PATCH(patchReq({ name: "Nativa 2" }), props("nope"));
    expect(res.status).toBe(404);
    expect(brandFindFirst.mock.calls[0][0].where).toEqual({ id: "nope", deletedAt: null });
    expect(brandUpdate).not.toHaveBeenCalled();
  });

  it("PATCH válido → 200 y auditLog con los campos tocados", async () => {
    const res = await PATCH(patchReq({ name: "Nativa 2", persona: "Asesora cálida" }), props());
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe("b1");
    expect(brandUpdate.mock.calls[0][0].where).toEqual({ id: "b1" });
    expect(brandUpdate.mock.calls[0][0].data).toEqual({ name: "Nativa 2", persona: "Asesora cálida" });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      userId: "u1",
      action: "UPDATE",
      entity: "Brand",
      entityId: "b1",
      changes: { fields: ["name", "persona"] },
    });
  });

  it("enabledChannels null se guarda como Prisma.DbNull", async () => {
    await PATCH(patchReq({ enabledChannels: null }), props());
    expect(brandUpdate.mock.calls[0][0].data.enabledChannels).toBe(Prisma.DbNull);
  });

  it("enabledChannels: [] → 400 y no actualiza (silenciaría al agente; heredar es null)", async () => {
    const res = await PATCH(patchReq({ enabledChannels: [] }), props());
    expect(res.status).toBe(400);
    expect(brandUpdate).not.toHaveBeenCalled();
  });

  it("playbookId inexistente → 400 y no actualiza", async () => {
    playbookFindFirst.mockResolvedValue(null);
    const res = await PATCH(patchReq({ playbookId: UUID_PB }), props());
    expect(res.status).toBe(400);
    expect(brandUpdate).not.toHaveBeenCalled();
  });

  it("marketingOwnerUserId inactivo → 400 y no actualiza", async () => {
    userFindFirst.mockResolvedValue(null);
    const res = await PATCH(patchReq({ marketingOwnerUserId: "9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" }), props());
    expect(res.status).toBe(400);
    expect(brandUpdate).not.toHaveBeenCalled();
  });

  it("nombre repetido (P2002) → 409", async () => {
    brandUpdate.mockRejectedValue({ code: "P2002" });
    const res = await PATCH(patchReq({ name: "Propyte" }), props());
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/admin/brands/[id]", () => {
  it("sin sesión o sin permiso de escritura → 403", async () => {
    hasSession = false;
    expect((await DELETE(delReq(), props())).status).toBe(403);
    hasSession = true;
    session.user.role = "MARKETING";
    expect((await DELETE(delReq(), props())).status).toBe(403);
    expect(brandUpdate).not.toHaveBeenCalled();
  });

  it("la predeterminada no se borra → 400", async () => {
    brandFindFirst.mockResolvedValue(DEFAULT_BRAND);
    const res = await DELETE(delReq(), props("b0"));
    expect(res.status).toBe(400);
    expect(brandUpdate).not.toHaveBeenCalled();
    expect(connectorCount).not.toHaveBeenCalled();
  });

  it("con cuentas activas → 409 y no borra", async () => {
    connectorCount.mockResolvedValue(2);
    const res = await DELETE(delReq(), props());
    expect(res.status).toBe(409);
    expect(connectorCount.mock.calls[0][0].where).toEqual({
      brandId: "b1",
      status: "ACTIVE",
      deletedAt: null,
    });
    expect(brandUpdate).not.toHaveBeenCalled();
  });

  it("marca inexistente → 404", async () => {
    brandFindFirst.mockResolvedValue(null);
    expect((await DELETE(delReq(), props("nope"))).status).toBe(404);
    expect(brandUpdate).not.toHaveBeenCalled();
  });

  it("borrado válido → borrado lógico (deletedAt) con el bot apagado, y auditLog", async () => {
    const res = await DELETE(delReq(), props());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const arg = brandUpdate.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "b1" });
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
    expect(arg.data.botEnabled).toBe(false);

    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      userId: "u1",
      action: "DELETE",
      entity: "Brand",
      entityId: "b1",
    });
  });
});
