// Caso 2 punto 6 (social↔ads linking): el path DUPLICADO de captureLead hoy
// descarta cualquier dato de atribución que traiga el lead repetido — esta
// suite fija que, si el contacto existente aún no tiene AdAttribution, se crea.
import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
const adAttrFindUnique = vi.fn();
const adAttrCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
    adAttribution: {
      findUnique: (...a: unknown[]) => adAttrFindUnique(...a),
      create: (...a: unknown[]) => adAttrCreate(...a),
    },
    activity: { create: vi.fn(async () => ({})) },
  },
}));
vi.mock("@/lib/workflows/routing", () => ({ autoRouteLead: vi.fn(async () => "u1") }));
vi.mock("@/lib/workflows/events", () => ({ emitEvent: vi.fn() }));

import { captureLead } from "./capture-lead";

beforeEach(() => {
  [findFirst, create, update, adAttrFindUnique, adAttrCreate].forEach((m) => m.mockReset());
  update.mockResolvedValue({});
  adAttrCreate.mockResolvedValue({});
});

describe("captureLead — atribución en el path DUPLICADO (Caso 2.6)", () => {
  it("lead repetido con gclid y contacto sin AdAttribution → crea AdAttribution", async () => {
    findFirst.mockResolvedValue({ id: "c-dup", assignedToId: "u1" });
    adAttrFindUnique.mockResolvedValue(null);
    await captureLead({ source: "GOOGLE_ADS", firstName: "X", email: "x@x.com", gclid: "GCLID-1" });
    expect(create).not.toHaveBeenCalled();
    expect(adAttrFindUnique).toHaveBeenCalledWith({ where: { contactId: "c-dup" } });
    expect(adAttrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: "c-dup", gclid: "GCLID-1" }) })
    );
  });

  it("lead repetido con datos de atribución pero el contacto YA tiene AdAttribution → no crea otra", async () => {
    findFirst.mockResolvedValue({ id: "c-dup2", assignedToId: "u1" });
    adAttrFindUnique.mockResolvedValue({ id: "attr-existing" });
    await captureLead({ source: "GOOGLE_ADS", firstName: "X", email: "x2@x.com", gclid: "GCLID-2" });
    expect(adAttrCreate).not.toHaveBeenCalled();
  });

  it("lead repetido SIN datos de atribución → no consulta ni crea AdAttribution", async () => {
    findFirst.mockResolvedValue({ id: "c-dup3", assignedToId: "u1" });
    await captureLead({ source: "WEBSITE", firstName: "X", email: "x3@x.com" });
    expect(adAttrFindUnique).not.toHaveBeenCalled();
    expect(adAttrCreate).not.toHaveBeenCalled();
  });

  it("regresión: contacto NUEVO con gclid sigue creando AdAttribution (comportamiento previo intacto)", async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({ id: "c-new", assignedToId: null });
    await captureLead(
      { source: "GOOGLE_ADS", firstName: "Nuevo", email: "nuevo@x.com", gclid: "GCLID-3" },
      { skipRouting: true }
    );
    expect(adAttrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: "c-new", gclid: "GCLID-3" }) })
    );
  });
});
