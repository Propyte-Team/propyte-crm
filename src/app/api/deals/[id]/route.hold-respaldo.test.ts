import { describe, it, expect, vi, beforeEach } from "vitest";

// #961 — apartar cuando el Hub no contesta: si no está configurado o no responde, se aparta en el
// CRM con la marca «Pendiente de apartar en el Hub», siempre que la unidad esté libre por lo que sí
// se sabe (catálogo del Hub por SQL y las demás operaciones del CRM). Un «no» del Hub se respeta.

const session = { user: { id: "u1", role: "ASESOR", plaza: "PDC" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const dealFindUnique = vi.fn();
const dealFindFirst = vi.fn();
const txDealUpdate = vi.fn();
const txActivityCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    deal: {
      findUnique: (...a: unknown[]) => dealFindUnique(...a),
      findFirst: (...a: unknown[]) => dealFindFirst(...a),
      update: vi.fn(async () => ({})),
    },
    unit: { update: vi.fn(), findUnique: vi.fn(async () => null) },
    development: { update: vi.fn(), findUnique: vi.fn(async () => null) },
    activity: { create: vi.fn() },
  },
}));

vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_o: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      deal: { update: (...a: unknown[]) => txDealUpdate(...a) },
      unit: { findUnique: vi.fn(async () => null), update: vi.fn() },
      development: { update: vi.fn() },
      activity: { create: (...a: unknown[]) => txActivityCreate(...a) },
    }),
}));

const requestUnitHold = vi.fn();
const confirmUnitHold = vi.fn();
const getHubUnit = vi.fn();
vi.mock("@/lib/hub/client", () => ({
  requestUnitHold: (...a: unknown[]) => requestUnitHold(...a),
  confirmUnitHold: (...a: unknown[]) => confirmUnitHold(...a),
  releaseUnitHold: vi.fn(async () => ({ ok: true })),
  getHubUnit: (...a: unknown[]) => getHubUnit(...a),
}));

// Las marcas no son lo que se prueba aquí: el asesor ve el negocio.
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: vi.fn(async () => ["PROPYTE"]) }));
vi.mock("@/lib/brands/visibility", () => ({ CONTACT_BRAND_SELECT: { select: { brand: true } }, canSeeDealBrand: () => true }));

import { PATCH } from "./route";

const DEAL_ID = "44444444-4444-4444-4444-444444444444";

function req(body: unknown) {
  return new Request(`http://localhost/api/deals/${DEAL_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}
const params = { params: Promise.resolve({ id: DEAL_ID }) };

function operacion(extra: Record<string, unknown> = {}) {
  dealFindUnique.mockResolvedValue({
    id: DEAL_ID,
    stage: "PROPOSAL_SENT",
    tipoOperacion: "VENTA",
    etapa: "EN_PREPARACION",
    subestado: null,
    contratoFirmado: false,
    enganchePagado: false,
    reapartados: 0,
    flujo: "F5_NATIVA",
    contactId: "contact-1",
    assignedToId: "u1",
    unitId: null,
    developmentId: null,
    hubUnitId: "hub-unit-1",
    hubDevelopmentId: "hub-dev-1",
    externalBrokerId: null,
    leadSourceAtDeal: "META_ADS",
    estimatedValue: 2_000_000,
    dealType: "NATIVA_CONTADO",
    custom: { nota: "previa" },
    reservedAt: null,
    contractSignedAt: null,
    deedAt: null,
    deliveredAt: null,
    contact: { id: "contact-1" },
    assignedTo: { id: "u1", plaza: "PDC", teamLeaderId: null },
    development: null,
    unit: null,
    activities: [],
    ...extra,
  });
}

/** Lo que se escribió en el negocio. */
const escrito = () => txDealUpdate.mock.calls[0][0].data;

beforeEach(() => {
  session.user.role = "ASESOR";
  for (const m of [dealFindUnique, dealFindFirst, txDealUpdate, txActivityCreate, requestUnitHold, confirmUnitHold, getHubUnit]) m.mockReset();
  dealFindFirst.mockResolvedValue(null);
  txDealUpdate.mockResolvedValue({ id: DEAL_ID, unitId: null, developmentId: null, estimatedValue: 2_000_000, assignedToId: "u1" });
  txActivityCreate.mockResolvedValue({});
  requestUnitHold.mockResolvedValue({ ok: true, unit: { id: "hub-unit-1", status: "APARTADA", holdExpiresAt: "2026-11-18T00:00:00Z" } });
  confirmUnitHold.mockResolvedValue({ ok: true });
  getHubUnit.mockResolvedValue({ id: "hub-unit-2", numero: "B-204", developmentId: "hub-dev-1" });
});

const SIN_HUB = { ok: false, motivo: "sin_configurar", error: "Hub API no configurada (HUB_API_BASE_URL / HUB_API_KEY)" };

describe("PATCH /api/deals/[id] — apartar sin el Hub (#961)", () => {
  it("Hub sin configurar y unidad libre: aparta en el CRM con la marca y avisa", async () => {
    operacion();
    requestUnitHold.mockResolvedValue(SIN_HUB);
    getHubUnit.mockResolvedValue({ id: "hub-unit-1", numero: "A-3", status: "Preventa" });
    const res = await PATCH(req({ etapa: "APARTADO" }), params);
    expect(res.status).toBe(200);
    expect(escrito()).toMatchObject({ etapa: "APARTADO", stage: "RESERVED" });
    expect(escrito().reservedAt).toBeInstanceOf(Date);
    expect(escrito().holdId).toBeUndefined();
    expect(escrito().custom).toMatchObject({ nota: "previa", hubHoldPendiente: { motivo: "sin_configurar" } });
    expect((await res.json()).aviso).toMatch(/Pendiente de apartar en el Hub/);
  });

  it("el Hub no responde (sin_respuesta): mismo respaldo", async () => {
    operacion();
    requestUnitHold.mockResolvedValue({ ok: false, motivo: "sin_respuesta", error: "Hub respondió 502" });
    const res = await PATCH(req({ etapa: "APARTADO" }), params);
    expect(res.status).toBe(200);
    expect(escrito().custom.hubHoldPendiente).toMatchObject({ motivo: "sin_respuesta", error: "Hub respondió 502" });
  });

  it("si el inventario dice que está vendida o apartada, no se aparta", async () => {
    operacion();
    requestUnitHold.mockResolvedValue(SIN_HUB);
    getHubUnit.mockResolvedValue({ id: "hub-unit-1", numero: "A-3", status: "Vendida" });
    const res = await PATCH(req({ etapa: "APARTADO" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Vendida/);
    expect(txDealUpdate).not.toHaveBeenCalled();
  });

  it("si otra operación activa del CRM ya tiene la unidad, no se aparta", async () => {
    operacion();
    requestUnitHold.mockResolvedValue(SIN_HUB);
    getHubUnit.mockResolvedValue({ id: "hub-unit-1", numero: "A-3", status: "Disponible" });
    dealFindFirst.mockResolvedValue({ id: "otro", contact: { firstName: "Ana", lastName: "Paz" } });
    const res = await PATCH(req({ etapa: "APARTADO" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/otra operación del CRM \(Ana Paz\)/);
    expect(dealFindFirst.mock.calls[0][0].where).toMatchObject({ hubUnitId: "hub-unit-1", id: { not: DEAL_ID }, deletedAt: null });
    expect(txDealUpdate).not.toHaveBeenCalled();
  });

  it("un «no» del Hub se respeta: sin respaldo", async () => {
    operacion();
    requestUnitHold.mockResolvedValue({ ok: false, motivo: "rechazo", error: "Unidad ya apartada" });
    const res = await PATCH(req({ etapa: "APARTADO" }), params);
    expect(res.status).toBe(409);
    expect(getHubUnit).not.toHaveBeenCalled();
    expect(txDealUpdate).not.toHaveBeenCalled();
  });

  it("«Apartar en el Hub»: si ya contesta, toma el hold y quita la marca sin mover el reloj ni el contador", async () => {
    const reservada = new Date("2026-11-01T12:00:00Z");
    operacion({
      stage: "RESERVED",
      etapa: "APARTADO",
      subestado: "PAGADO",
      reservedAt: reservada,
      custom: { nota: "previa", hubHoldPendiente: { desde: "2026-11-01T12:00:00Z", motivo: "sin_configurar", error: null } },
    });
    const res = await PATCH(req({ reintentarHold: true }), params);
    expect(res.status).toBe(200);
    expect(escrito().holdId).toBe("hub-unit-1");
    expect(escrito().custom).toEqual({ nota: "previa" });
    expect(escrito().reservedAt).toBeUndefined();
    expect(escrito().reapartados).toBeUndefined();
  });

  it("«Apartar en el Hub» sin marca es un error; si el Hub sigue sin contestar, avisa y no guarda", async () => {
    operacion({ stage: "RESERVED", etapa: "APARTADO", subestado: "PAGADO" });
    expect((await PATCH(req({ reintentarHold: true }), params)).status).toBe(400);
    operacion({
      stage: "RESERVED",
      etapa: "APARTADO",
      subestado: "PAGADO",
      custom: { hubHoldPendiente: { desde: "2026-11-01T12:00:00Z", motivo: "sin_configurar", error: null } },
    });
    requestUnitHold.mockResolvedValue(SIN_HUB);
    const res = await PATCH(req({ reintentarHold: true }), params);
    expect(res.status).toBe(503);
    expect(txDealUpdate).not.toHaveBeenCalled();
  });
});
