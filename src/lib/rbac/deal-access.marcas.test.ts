// verificarAccesoANegocio con filtro por marca (2026-10-12, spec marcas-visibilidad). Todo lo
// que cuelga de un negocio (cotizaciones, documentos, shortlists, vínculos, campos custom) pasa
// por aquí, así que la marca del contacto del negocio se decide en un solo lugar.
import { describe, it, expect, vi, beforeEach } from "vitest";

const dealFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({ default: { deal: { findFirst: (...a: unknown[]) => dealFindFirst(...a) } } }));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { verificarAccesoANegocio } from "./deal-access";

const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };
const DIRECTOR = { id: "dir-1", role: "DIRECTOR", plaza: "CANCUN" };
const ASESOR = { id: "ase-1", role: "ASESOR_SR", plaza: "CANCUN" };

const negocio = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  assignedToId: "ase-2",
  assignedTo: { plaza: "CANCUN", teamLeaderId: null },
  contact: { assignedToId: "ase-2", brands: [{ brandId: "b-yax" }] },
  ...over,
});

beforeEach(() => {
  dealFindFirst.mockReset();
  getVisibleBrands.mockReset().mockResolvedValue(SOLO_PROPYTE);
});

describe("verificarAccesoANegocio — marcas", () => {
  it("carga el contacto con sus marcas", async () => {
    dealFindFirst.mockResolvedValue(negocio());
    await verificarAccesoANegocio("d1", DIRECTOR, "ver");
    expect(dealFindFirst.mock.calls[0][0].select.contact).toEqual({
      select: { assignedToId: true, brands: { select: { brandId: true } } },
    });
  });

  it("DIRECTOR (rol total) sin Yaxnáh y negocio de un contacto de Yaxnáh → forbidden (el llamador responde 404)", async () => {
    dealFindFirst.mockResolvedValue(negocio());
    expect(await verificarAccesoANegocio("d1", DIRECTOR, "ver")).toEqual({ ok: false, reason: "forbidden" });
  });

  it("DIRECTOR con Yaxnáh → ok", async () => {
    getVisibleBrands.mockResolvedValue({ brandIds: ["b-def", "b-yax"], includesDefault: true });
    dealFindFirst.mockResolvedValue(negocio());
    expect((await verificarAccesoANegocio("d1", DIRECTOR, "ver")).ok).toBe(true);
  });

  it("negocio asignado a mí, aunque el contacto sea de Yaxnáh → ok", async () => {
    dealFindFirst.mockResolvedValue(negocio({ assignedToId: "ase-1" }));
    expect((await verificarAccesoANegocio("d1", ASESOR, "editar")).ok).toBe(true);
  });

  it("contacto sin filas (Propyte) → ok para quien ve Propyte", async () => {
    dealFindFirst.mockResolvedValue(negocio({ contact: { assignedToId: "ase-2", brands: [] } }));
    expect((await verificarAccesoANegocio("d1", DIRECTOR, "ver")).ok).toBe(true);
  });

  it("el rol se decide primero y no se consultan marcas si ya está fuera de alcance", async () => {
    dealFindFirst.mockResolvedValue(negocio({ contact: { assignedToId: "ase-2", brands: [] } }));
    expect(await verificarAccesoANegocio("d1", ASESOR, "ver")).toEqual({ ok: false, reason: "forbidden" });
    expect(getVisibleBrands).not.toHaveBeenCalled();
  });

  it("negocio inexistente → not_found", async () => {
    dealFindFirst.mockResolvedValue(null);
    expect(await verificarAccesoANegocio("d1", DIRECTOR)).toEqual({ ok: false, reason: "not_found" });
  });
});
