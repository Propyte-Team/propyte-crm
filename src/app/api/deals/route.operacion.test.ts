import { describe, it, expect, vi, beforeEach } from "vitest";

// #957 — POST /api/deals con etapa «en preparación»: la operación para cotizar. Nace en Propuesta
// (etapa vieja) y su tipo sale del flujo si no se elige.

const session = { user: { id: "u1", role: "ASESOR", plaza: "CANCUN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const dealCreate = vi.fn();
const activityCreate = vi.fn();
const contactFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    development: { findUnique: vi.fn() },
    unit: { findUnique: vi.fn() },
    deal: { create: (...a: unknown[]) => dealCreate(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
  },
}));

import { POST } from "./route";

const BASE = {
  contactId: "11111111-1111-1111-1111-111111111111",
  dealType: "CORRETAJE",
  estimatedValue: 1000000,
  leadSourceAtDeal: "META_ADS",
  expectedCloseDate: "2026-12-15",
};

function req(body: unknown) {
  return new Request("http://localhost/api/deals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}
const creado = () => dealCreate.mock.calls[0][0].data;

beforeEach(() => {
  dealCreate.mockReset();
  activityCreate.mockReset();
  contactFindUnique.mockReset();
  dealCreate.mockResolvedValue({ id: "deal-1", assignedToId: "u1", contact: { firstName: "Ana", lastName: "Paz" }, development: null });
  activityCreate.mockResolvedValue({ id: "act-1" });
  contactFindUnique.mockResolvedValue({ leadSource: "META_ADS", flujo: "F1_CORRETAJE_VENDEDOR" });
});

describe("POST /api/deals — operación en preparación (#957)", () => {
  it("nace en preparación, en Propuesta, con el tipo del flujo del contacto", async () => {
    const res = await POST(req({ ...BASE, etapa: "EN_PREPARACION" }));
    expect(res.status).toBe(201);
    expect(creado()).toMatchObject({ etapa: "EN_PREPARACION", stage: "PROPOSAL_SENT", tipoOperacion: "CONTRATO_INTERMEDIACION" });
    expect(activityCreate.mock.calls[0][0].data.subject).toBe("Operación creada");
  });

  it("Nativa es venta aunque el contacto tenga otro flujo; el tipo elegido manda", async () => {
    await POST(req({ ...BASE, dealType: "NATIVA_CONTADO", etapa: "EN_PREPARACION" }));
    expect(creado().tipoOperacion).toBe("VENTA");
    dealCreate.mockClear();
    await POST(req({ ...BASE, etapa: "EN_PREPARACION", tipoOperacion: "CONVENIO_ALIADO", propiedadDescripcion: "Casa en Tulum" }));
    expect(creado()).toMatchObject({ tipoOperacion: "CONVENIO_ALIADO", propiedadDescripcion: "Casa en Tulum" });
  });

  it("una operación no nace apartada ni firmada", async () => {
    for (const etapa of ["APARTADO", "FIRMA"]) {
      expect((await POST(req({ ...BASE, etapa }))).status).toBe(400);
    }
    expect(dealCreate).not.toHaveBeenCalled();
  });

  it("sin etapa sigue siendo el negocio de siempre (el tablero de Negocios)", async () => {
    const res = await POST(req(BASE));
    expect(res.status).toBe(201);
    expect(creado().etapa).toBeUndefined();
    expect(creado().stage).toBe("NEW_LEAD");
  });
});
