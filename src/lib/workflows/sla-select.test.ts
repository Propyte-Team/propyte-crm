import { describe, it, expect } from "vitest";
import { selectSlaPolicy, type SlaPolicyLike } from "./sla-select";

const base: Omit<SlaPolicyLike, "id" | "name"> = { isActive: true, isDefault: false, priority: 100, conditions: {} };
const P = (id: string, over: Partial<SlaPolicyLike>): SlaPolicyLike => ({ ...base, id, name: id, ...over });
const brokerCond = { all: [{ field: "contact.contactType", op: "eq", value: "BROKER_EXTERNO" }] };

describe("selectSlaPolicy", () => {
  const def = P("def", { isDefault: true, priority: 999, conditions: {} });

  it("elige la política cuyo segmento cumple", () => {
    const seg = P("seg", { priority: 10, conditions: brokerCond });
    const r = selectSlaPolicy([def, seg], { contact: { contactType: "BROKER_EXTERNO" } });
    expect(r?.id).toBe("seg");
  });
  it("cae a la default cuando ningún segmento cumple", () => {
    const seg = P("seg", { priority: 10, conditions: brokerCond });
    const r = selectSlaPolicy([def, seg], { contact: { contactType: "COMPRADOR" } });
    expect(r?.id).toBe("def");
  });
  it("gana la de menor número de prioridad", () => {
    const a = P("a", { priority: 50, conditions: {} });
    const b = P("b", { priority: 10, conditions: {} });
    expect(selectSlaPolicy([def, a, b], {})?.id).toBe("b");
  });
  it("ignora inactivas", () => {
    const seg = P("seg", { priority: 1, isActive: false, conditions: brokerCond });
    const r = selectSlaPolicy([def, seg], { contact: { contactType: "BROKER_EXTERNO" } });
    expect(r?.id).toBe("def");
  });
  it("sin match y sin default → null", () => {
    const seg = P("seg", { priority: 10, conditions: brokerCond });
    expect(selectSlaPolicy([seg], { contact: { contactType: "COMPRADOR" } })).toBeNull();
  });
  it("la default no participa en la fase de match (solo como fallback)", () => {
    const d2 = P("d2", { isDefault: true, priority: 1, conditions: brokerCond });
    const seg = P("seg", { priority: 10, conditions: brokerCond });
    expect(selectSlaPolicy([d2, seg], { contact: { contactType: "BROKER_EXTERNO" } })?.id).toBe("seg");
  });
});
