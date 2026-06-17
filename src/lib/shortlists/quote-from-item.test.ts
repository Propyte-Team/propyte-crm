import { describe, it, expect } from "vitest";
import { pickSnapshotPrice } from "./quote-from-item";

describe("pickSnapshotPrice", () => {
  it("MXN → usa precioMxn", () => {
    expect(pickSnapshotPrice({ moneda: "MXN", precioMxn: 5200000, precioUsd: null }))
      .toEqual({ listPrice: 5200000, currency: "MXN" });
  });
  it("USD → usa precioUsd", () => {
    expect(pickSnapshotPrice({ moneda: "USD", precioMxn: null, precioUsd: 260000 }))
      .toEqual({ listPrice: 260000, currency: "USD" });
  });
  it("sin moneda → default MXN", () => {
    expect(pickSnapshotPrice({ precioMxn: 100, precioUsd: null }).currency).toBe("MXN");
  });
  it("sin precio → listPrice null", () => {
    expect(pickSnapshotPrice({ moneda: "MXN", precioMxn: null, precioUsd: null }).listPrice).toBeNull();
  });
  it("item optimista → fallback a price", () => {
    expect(pickSnapshotPrice({ moneda: "MXN", price: 3300000 }))
      .toEqual({ listPrice: 3300000, currency: "MXN" });
  });
});
