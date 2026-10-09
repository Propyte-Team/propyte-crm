// PATCH /api/admin/connectors/[id] · brandId (2026-10-09): reasignar la marca de una cuenta.
// `brandId: null` la devuelve a la marca predeterminada (cuenta sin marca); un id solo se acepta
// si la marca existe y no está borrada.
import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "MARKETING" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const connectorUpdate = vi.fn();
const brandFindFirst = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: { update: (...a: unknown[]) => connectorUpdate(...a) },
    brand: { findFirst: (...a: unknown[]) => brandFindFirst(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

// Cifrar necesita la llave de PII del entorno; aquí no se prueban credenciales.
vi.mock("@/lib/intake/connectors", () => ({ writeCredentials: () => "cifrado" }));

import { PATCH } from "./route";

const BRAND_ID = "3f2b8c1e-5d4a-4b6f-9c7e-1a2b3c4d5e6f";
const props = { params: Promise.resolve({ id: "c1" }) };
const req = (body: unknown) => ({ json: () => Promise.resolve(body) }) as never;

beforeEach(() => {
  for (const m of [connectorUpdate, brandFindFirst, auditCreate]) m.mockReset();
  session.user.role = "MARKETING";
  connectorUpdate.mockResolvedValue({ id: "c1", name: "WhatsApp | Nativa", provider: "WHATSAPP", status: "PAUSED" });
  brandFindFirst.mockResolvedValue({ id: BRAND_ID });
  auditCreate.mockResolvedValue({});
});

describe("PATCH /api/admin/connectors/[id] · brandId", () => {
  it("brandId válido → se guarda y se audita el campo", async () => {
    const res = await PATCH(req({ brandId: BRAND_ID }), props);
    expect(res.status).toBe(200);
    expect(brandFindFirst.mock.calls[0][0].where).toEqual({ id: BRAND_ID, deletedAt: null });
    expect(connectorUpdate.mock.calls[0][0].data).toEqual({ brandId: BRAND_ID });
    expect(auditCreate.mock.calls[0][0].data.changes).toEqual({ fields: ["brandId"] });
  });

  it("brandId null → se guarda null sin consultar marcas", async () => {
    const res = await PATCH(req({ brandId: null }), props);
    expect(res.status).toBe(200);
    expect(brandFindFirst).not.toHaveBeenCalled();
    expect(connectorUpdate.mock.calls[0][0].data).toEqual({ brandId: null });
  });

  it("brandId inexistente o borrado → 400 'Marca no encontrada' y no actualiza", async () => {
    brandFindFirst.mockResolvedValue(null);
    const res = await PATCH(req({ brandId: BRAND_ID }), props);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Marca no encontrada");
    expect(connectorUpdate).not.toHaveBeenCalled();
  });

  it("brandId con formato inválido → 400", async () => {
    const res = await PATCH(req({ brandId: "no-es-uuid" }), props);
    expect(res.status).toBe(400);
    expect(connectorUpdate).not.toHaveBeenCalled();
  });

  it("sin brandId en el cuerpo no se toca la marca de la cuenta", async () => {
    const res = await PATCH(req({ status: "ACTIVE" }), props);
    expect(res.status).toBe(200);
    expect(brandFindFirst).not.toHaveBeenCalled();
    expect("brandId" in connectorUpdate.mock.calls[0][0].data).toBe(false);
  });

  it("rol sin permiso → 403", async () => {
    session.user.role = "ASESOR";
    const res = await PATCH(req({ brandId: BRAND_ID }), props);
    expect(res.status).toBe(403);
    expect(connectorUpdate).not.toHaveBeenCalled();
  });
});
