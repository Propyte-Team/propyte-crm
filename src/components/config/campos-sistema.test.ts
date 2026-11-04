import { describe, it, expect } from "vitest";
import { CAMPOS_DEL_SISTEMA, ACOPLAMIENTOS } from "./core-fields-section";
import { elegirPrincipal, type Ct } from "../contacts/duplicados-client";

const ct = (id: string, deals: number, acts: number, createdAt: string): Ct => ({
  id, firstName: "A", lastName: "B", email: null, phone: "1", createdAt,
  assignedTo: null, instagramId: null, messengerPsid: null, _count: { deals, activities: acts },
});

describe("visibilidad de campos", () => {
  it("marca como del sistema los campos calculados", () => {
    for (const k of ["score", "flujo", "contactStatus", "whatsappUserId"]) expect(CAMPOS_DEL_SISTEMA.has(k)).toBe(true);
    expect(CAMPOS_DEL_SISTEMA.has("email")).toBe(false);
  });
  it("documenta los acoplamientos", () => {
    expect(ACOPLAMIENTOS.estado).toMatch(/subestado/);
    expect(ACOPLAMIENTOS.referredById).toMatch(/referidos/);
  });
});

describe("elegirPrincipal", () => {
  it("prefiere más negocios+actividades y luego el más antiguo", () => {
    expect(elegirPrincipal([ct("a", 0, 1, "2024-01-01"), ct("b", 1, 1, "2025-01-01")]).id).toBe("b");
    expect(elegirPrincipal([ct("a", 1, 0, "2025-01-01"), ct("b", 1, 0, "2024-01-01")]).id).toBe("b");
  });
});
