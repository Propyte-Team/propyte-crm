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
    cbUpsert.mockRejectedValue(new Error("x"));
    await expect(attachBrand({ contactId: "k1", brandId: "b-yax", contactIsNew: true })).resolves.toBeUndefined();
  });
});
