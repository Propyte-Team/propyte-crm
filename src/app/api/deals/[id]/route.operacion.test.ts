import { describe, it, expect, vi, beforeEach } from "vitest";

// #957 — PATCH /api/deals/[id] con la operación: la etapa nueva se traduce a la vieja y pasa por las
// reglas de siempre (unidad y hold del Hub al apartar, comisión al ganar, motivo al perder).

const session = { user: { id: "u1", role: "ASESOR", plaza: "PDC" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const dealFindUnique = vi.fn();
const txDealUpdate = vi.fn();
const txActivityCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    deal: { findUnique: (...a: unknown[]) => dealFindUnique(...a), update: vi.fn(async () => ({})) },
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
  for (const m of [dealFindUnique, txDealUpdate, txActivityCreate, requestUnitHold, confirmUnitHold, getHubUnit]) m.mockReset();
  txDealUpdate.mockResolvedValue({ id: DEAL_ID, unitId: null, developmentId: null, estimatedValue: 2_000_000, assignedToId: "u1" });
  txActivityCreate.mockResolvedValue({});
  requestUnitHold.mockResolvedValue({ ok: true, unit: { id: "hub-unit-1", status: "APARTADA", holdExpiresAt: "2026-11-18T00:00:00Z" } });
  confirmUnitHold.mockResolvedValue({ ok: true });
  getHubUnit.mockResolvedValue({ id: "hub-unit-2", numero: "B-204", developmentId: "hub-dev-1" });
});

describe("PATCH /api/deals/[id] — operación (#957)", () => {
  it("apartar: etapa Apartado, etapa vieja Reservado y hold en el Hub", async () => {
    operacion();
    const res = await PATCH(req({ etapa: "APARTADO" }), params);
    expect(res.status).toBe(200);
    expect(escrito()).toMatchObject({ etapa: "APARTADO", subestado: "PENDIENTE_DE_PAGO", stage: "RESERVED", holdId: "hub-unit-1" });
    expect(escrito().reservedAt).toBeInstanceOf(Date);
    expect(requestUnitHold).toHaveBeenCalledWith({ hubUnitId: "hub-unit-1", crmDealId: DEAL_ID });
  });

  it("apartar sin unidad pide la unidad; con la unidad del Hub elegida, la congela y la aparta", async () => {
    operacion({ hubUnitId: null });
    const sin = await PATCH(req({ etapa: "APARTADO" }), params);
    expect(sin.status).toBe(400);
    expect(txDealUpdate).not.toHaveBeenCalled();

    const con = await PATCH(req({ etapa: "APARTADO", hubDevelopmentId: "hub-dev-1", hubUnitId: "hub-unit-2" }), params);
    expect(con.status).toBe(200);
    expect(requestUnitHold).toHaveBeenCalledWith({ hubUnitId: "hub-unit-2", crmDealId: DEAL_ID });
    expect(escrito()).toMatchObject({ hubUnitId: "hub-unit-2", stage: "RESERVED" });
    expect(escrito().custom).toMatchObject({ nota: "previa", hubUnitSnapshot: { numero: "B-204", source: "hub" } });
  });

  it("si el Hub no aparta, no se guarda nada (409)", async () => {
    operacion();
    requestUnitHold.mockResolvedValue({ ok: false, error: "Unidad vendida" });
    const res = await PATCH(req({ etapa: "APARTADO" }), params);
    expect(res.status).toBe(409);
    expect(txDealUpdate).not.toHaveBeenCalled();
  });

  it("una etapa que no sigue se rechaza con el campo", async () => {
    operacion();
    const res = await PATCH(req({ etapa: "ESCRITURA" }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ fields: ["etapa"] });
    expect(txDealUpdate).not.toHaveBeenCalled();
  });

  it("las dos casillas en Firma: devengo activo, Ganado y comisión; se confirma la unidad en el Hub", async () => {
    operacion({ stage: "CONTRACT_SIGNED", etapa: "FIRMA", subestado: "FIRMADO", contratoFirmado: true, reservedAt: new Date("2026-11-01") });
    const res = await PATCH(req({ enganchePagado: true }), params);
    expect(res.status).toBe(200);
    expect(escrito()).toMatchObject({ enganchePagado: true, subestado: "DEVENGO_ACTIVO", stage: "WON" });
    expect(escrito().actualCloseDate).toBeInstanceOf(Date);
    expect(confirmUnitHold).toHaveBeenCalledWith({ hubUnitId: "hub-unit-1", crmDealId: DEAL_ID });
  });

  it("una venta ya ganada (llenado de la migración) avanza a Escritura sin regresar la etapa vieja", async () => {
    operacion({ stage: "WON", etapa: "FIRMA", subestado: "DEVENGO_ACTIVO", contratoFirmado: true, enganchePagado: true });
    const res = await PATCH(req({ etapa: "ESCRITURA" }), params);
    expect(res.status).toBe(200);
    expect(escrito()).toMatchObject({ etapa: "ESCRITURA", subestado: "EN_TRAMITE_NOTARIAL" });
    expect(escrito().stage).toBeUndefined();
  });

  it("Escriturado y Entregada llenan sus fechas", async () => {
    operacion({ stage: "WON", etapa: "ESCRITURA", subestado: "FECHA_AGENDADA" });
    await PATCH(req({ subestado: "ESCRITURADO" }), params);
    expect(escrito().deedAt).toBeInstanceOf(Date);
    txDealUpdate.mockClear();
    operacion({ stage: "WON", etapa: "POSTVENTA", subestado: "ENTREGA_PENDIENTE" });
    await PATCH(req({ subestado: "ENTREGADA" }), params);
    expect(escrito().deliveredAt).toBeInstanceOf(Date);
  });

  it("reapartar suma uno, reinicia el reloj y renueva el hold", async () => {
    operacion({ stage: "RESERVED", etapa: "APARTADO", subestado: "PAGADO", reservedAt: new Date("2026-10-01"), reapartados: 1 });
    const res = await PATCH(req({ reapartar: true }), params);
    expect(res.status).toBe(200);
    expect(escrito().reapartados).toEqual({ increment: 1 });
    expect(escrito().reservedAt.getTime()).toBeGreaterThan(new Date("2026-10-02").getTime());
    expect(escrito().stage).toBeUndefined();
    expect(requestUnitHold).toHaveBeenCalledOnce();
  });

  it("cancelar: Perdido con motivo «Canceló apartado o contrato»", async () => {
    operacion({ stage: "RESERVED", etapa: "APARTADO", subestado: "PAGADO" });
    const res = await PATCH(req({ etapa: "CANCELADA" }), params);
    expect(res.status).toBe(200);
    expect(escrito()).toMatchObject({ etapa: "CANCELADA", subestado: null, stage: "LOST", lostReason: "OTRO", lostReasonDetail: "Canceló apartado o contrato" });
  });

  it("la etapa vieja de una operación ya no se mueve sola", async () => {
    operacion({ stage: "RESERVED", etapa: "APARTADO", subestado: "PAGADO" });
    const res = await PATCH(req({ stage: "WON" }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ fields: ["stage"] });
    expect(txDealUpdate).not.toHaveBeenCalled();
  });

  it("un negocio de antes se vuelve operación en preparación sin retroceder su etapa vieja", async () => {
    operacion({ stage: "NEGOTIATION", etapa: null, tipoOperacion: null, flujo: "F2_CORRETAJE_COMPRADOR" });
    const res = await PATCH(req({ etapa: "EN_PREPARACION" }), params);
    expect(res.status).toBe(200);
    expect(escrito()).toMatchObject({ etapa: "EN_PREPARACION", tipoOperacion: "VENTA" });
    expect(escrito().stage).toBeUndefined();
  });

  it("forzar es solo de administradores", async () => {
    operacion();
    expect((await PATCH(req({ etapa: "FIRMA", forzarCambio: true }), params)).status).toBe(403);
    expect(txDealUpdate).not.toHaveBeenCalled();
    session.user.role = "ADMIN";
    const res = await PATCH(req({ etapa: "FIRMA", forzarCambio: true }), params);
    expect(res.status).toBe(200);
    expect(escrito()).toMatchObject({ etapa: "FIRMA", stage: "CONTRACT_SIGNED" });
  });

  it("forma de pago, vigencia y comisión se guardan", async () => {
    operacion();
    const res = await PATCH(req({ formaPago: "CREDITO_BANCARIO", vigenciaHasta: "2027-05-01", porcentajeComision: 5, nivelMb: "MB2" }), params);
    expect(res.status).toBe(200);
    expect(escrito()).toMatchObject({ formaPago: "CREDITO_BANCARIO", porcentajeComision: 5, nivelMb: "MB2" });
    expect(escrito().vigenciaHasta.toISOString()).toBe("2027-05-01T00:00:00.000Z");
    expect((await PATCH(req({ formaPago: "TRUEQUE" }), params)).status).toBe(400);
  });
});
