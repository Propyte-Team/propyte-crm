// GET /api/contacts/export (#901): solo ADMIN/DIRECTOR, recorte por marca, registro en AuditLog.
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findMany: (...a: unknown[]) => contactFindMany(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));
const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));
const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { GET } from "./route";

const fila = (id: string, firstName: string, createdAt: string) => ({
  id, firstName, lastName: "X", email: null, phone: "+52999", secondaryPhone: null, contactType: null,
  contactStatus: "NUEVO", lifecycleStage: null, temperature: "COLD", score: 0, urgency: null, tags: [],
  leadSource: "OTRO", leadSourceDetail: null, targetPlaza: null, residenceCity: null, residenceCountry: null,
  nationality: null, preferredLanguage: "ES", investmentProfile: null, propertyType: null, purchaseTimeline: null,
  budgetMin: null, budgetMax: null, paymentMethod: null, preferredZone: null, purchaseModality: null,
  rentalStrategy: null, doNotContact: false, whatsappOptOut: false, createdAt, lastActivityAt: null,
  updatedAt: createdAt, assignedTo: null, brands: [], _count: { deals: 0, activities: 0 },
});

const get = (qs: string) => GET(new Request(`https://x/api/contacts/export${qs}`) as never);

beforeEach(() => {
  for (const m of [contactFindMany, auditCreate, getServerSession, getVisibleBrands]) m.mockReset();
  getVisibleBrands.mockResolvedValue("ALL");
  auditCreate.mockResolvedValue({});
  contactFindMany.mockResolvedValue([fila("a", "Ana", "2026-10-01T00:00:00Z"), fila("b", "Beto", "2026-10-10T00:00:00Z")]);
});

describe("GET /api/contacts/export", () => {
  it("sin sesión → 401", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await get("?campos=nombre")).status).toBe(401);
  });

  it.each(["GERENTE", "ASESOR", "MARKETING", "TEAM_LEADER"])("%s → 403 y no lee contactos", async (role) => {
    getServerSession.mockResolvedValue({ user: { id: "u", role } });
    expect((await get("?campos=nombre")).status).toBe(403);
    expect(contactFindMany).not.toHaveBeenCalled();
  });

  it("sin campos válidos → 400", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u", role: "ADMIN" } });
    expect((await get("?campos=inventado")).status).toBe(400);
  });

  it("ADMIN → CSV con los campos pedidos, más recientes primero, y registro EXPORT", async () => {
    getServerSession.mockResolvedValue({ user: { id: "adm", role: "ADMIN" } });
    const res = await get("?campos=nombre,telefono");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment; filename="contactos-\d{4}-\d{2}-\d{2}\.csv"/);
    const body = await res.text();
    expect(body.replace("﻿", "").trim().split("\r\n")).toEqual([
      '"Nombre","Teléfono"',
      '"Beto","=""+52999"""',
      '"Ana","=""+52999"""',
    ]);
    expect(contactFindMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "adm", action: "EXPORT", entity: "Contact",
        changes: { contactos: 2, campos: ["nombre", "telefono"], truncado: false },
      }),
    });
  });

  it("DIRECTOR con marcas acotadas → la descarga lleva el mismo recorte por marca que la lista", async () => {
    getServerSession.mockResolvedValue({ user: { id: "dir", role: "DIRECTOR" } });
    getVisibleBrands.mockResolvedValue({ brandIds: ["b-def"], includesDefault: true });
    await get("?campos=nombre");
    expect(contactFindMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      AND: [{ OR: [{ assignedToId: "dir" }, { brands: { some: { brandId: { in: ["b-def"] } } } }, { brands: { none: {} } }] }],
    });
  });

  it("si el registro de auditoría falla, no se entrega el archivo", async () => {
    getServerSession.mockResolvedValue({ user: { id: "adm", role: "ADMIN" } });
    auditCreate.mockRejectedValue(new Error("db"));
    await expect(get("?campos=nombre")).rejects.toThrow();
  });

  it("lee por tandas con cursor hasta agotar", async () => {
    getServerSession.mockResolvedValue({ user: { id: "adm", role: "ADMIN" } });
    const mil = Array.from({ length: 1000 }, (_, i) => fila(`id${String(i).padStart(4, "0")}`, "N", "2026-10-01T00:00:00Z"));
    contactFindMany.mockReset();
    contactFindMany.mockResolvedValueOnce(mil).mockResolvedValueOnce([fila("zz", "Z", "2026-10-02T00:00:00Z")]);
    const res = await get("?campos=nombre");
    expect(res.headers.get("X-Contactos-Exportados")).toBe("1001");
    expect(contactFindMany).toHaveBeenCalledTimes(2);
    expect(contactFindMany.mock.calls[1][0]).toMatchObject({ skip: 1, cursor: { id: "id0999" } });
  });
});
