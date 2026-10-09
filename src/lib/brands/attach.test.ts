import { describe, it, expect, vi, beforeEach } from "vitest";

const cbCount = vi.fn();
const cbUpsert = vi.fn();
const cbCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contactBrand: {
      count: (...a: unknown[]) => cbCount(...a),
      upsert: (...a: unknown[]) => cbUpsert(...a),
      create: (...a: unknown[]) => cbCreate(...a),
    },
  },
}));
const getDefaultBrandId = vi.fn();
vi.mock("./resolve", () => ({ getDefaultBrandId: () => getDefaultBrandId() }));

import { attachBrand } from "./attach";

beforeEach(() => {
  vi.resetAllMocks();
  getDefaultBrandId.mockResolvedValue("b-def");
  cbUpsert.mockResolvedValue({});
  cbCreate.mockResolvedValue({});
});

describe("attachBrand", () => {
  it("contacto nuevo → solo la fila de su marca", async () => {
    await attachBrand({ contactId: "k1", brandId: "b-yax", connectorId: "c1", contactIsNew: true });
    expect(cbCount).not.toHaveBeenCalled();
    expect(cbUpsert).toHaveBeenCalledTimes(1);
    expect(cbUpsert).toHaveBeenCalledWith({
      where: { contactId_brandId: { contactId: "k1", brandId: "b-yax" } },
      create: { contactId: "k1", brandId: "b-yax", firstConnectorId: "c1" },
      update: {},
    });
  });
  it("contacto existente SIN filas que llega por otra marca → también queda en la predeterminada", async () => {
    cbCount.mockResolvedValue(0);
    await attachBrand({ contactId: "k1", brandId: "b-yax", connectorId: "c1", contactIsNew: false });
    expect(cbUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { contactId_brandId: { contactId: "k1", brandId: "b-def" } },
    }));
    expect(cbUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { contactId_brandId: { contactId: "k1", brandId: "b-yax" } },
    }));
  });
  it("contacto existente con filas → no agrega la predeterminada", async () => {
    cbCount.mockResolvedValue(1);
    await attachBrand({ contactId: "k1", brandId: "b-yax", contactIsNew: false });
    expect(cbUpsert).toHaveBeenCalledTimes(1);
  });
  it("la marca ES la predeterminada → una sola fila", async () => {
    cbCount.mockResolvedValue(0);
    await attachBrand({ contactId: "k1", brandId: "b-def", contactIsNew: false });
    expect(cbUpsert).toHaveBeenCalledTimes(1);
  });
  it("un fallo de DB no lanza (la atribución nunca rompe la entrada del lead)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    cbUpsert.mockRejectedValue(new Error("x"));
    await expect(attachBrand({ contactId: "k1", brandId: "b-yax", contactIsNew: true })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[brands]"), "k1", "b-yax", expect.any(Error));
    error.mockRestore();
  });
});

// Hallazgo I1 de la revisión final: sin el id de la predeterminada (no se pudo leer, o no existe),
// a un contacto que YA existía no se le puede registrar primero la predeterminada. Escribir solo la
// fila de la otra marca lo sacaría de Propyte para siempre (un contacto con filas pertenece SOLO a
// sus filas). Se registra el error y no se escribe nada: sin filas sigue siendo de la predeterminada
// y la siguiente entrada del lead lo vuelve a intentar.
describe("attachBrand — sin la marca predeterminada", () => {
  it("contacto existente y getDefaultBrandId → null: no escribe NADA y registra el error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    getDefaultBrandId.mockResolvedValue(null);
    cbCount.mockResolvedValue(0);

    await attachBrand({ contactId: "k1", brandId: "b-yax", connectorId: "c1", contactIsNew: false });

    expect(cbUpsert).not.toHaveBeenCalled();
    expect(cbCreate).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[brands]"), "k1", "b-yax");
    error.mockRestore();
  });

  it("contacto NUEVO y getDefaultBrandId → null: igual registra su marca (no hay pertenencia previa que perder)", async () => {
    getDefaultBrandId.mockResolvedValue(null);

    await attachBrand({ contactId: "k1", brandId: "b-yax", connectorId: "c1", contactIsNew: true });

    expect(cbUpsert).toHaveBeenCalledTimes(1);
    expect(cbUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { contactId_brandId: { contactId: "k1", brandId: "b-yax" } },
    }));
  });
});
