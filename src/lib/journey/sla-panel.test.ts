import { describe, it, expect } from "vitest";
import { filasDeSla, type PoliticaSla } from "./sla-panel";

const base: PoliticaSla = {
  id: "s1", name: "General", isActive: true, isDefault: true, priority: 100,
  firstTouchMinutes: 15, retryMinutes: 60, orphanHours: 24, conditions: {},
};

describe("filasDeSla", () => {
  it("solo las activas", () => {
    expect(filasDeSla([base, { ...base, id: "s2", isActive: false, isDefault: false }]).map((f) => f.id)).toEqual(["s1"]);
  });
  it("de menor a mayor número de prioridad", () => {
    const vip: PoliticaSla = { ...base, id: "vip", isDefault: false, priority: 10, conditions: { all: [{ field: "contact.score", op: "gte", value: 80 }] } };
    expect(filasDeSla([base, vip]).map((f) => f.id)).toEqual(["vip", "s1"]);
  });
  it("la general dice «Todos los contactos»; las demás, su segmento en frase", () => {
    const vip: PoliticaSla = { ...base, id: "vip", isDefault: false, priority: 10, conditions: { all: [{ field: "contact.score", op: "gte", value: 80 }] } };
    const [a, b] = filasDeSla([vip, base]);
    expect(a.aQuien).not.toBe("Todos los contactos");
    expect(a.aQuien).not.toMatch(/contact\./);
    expect(b.aQuien).toBe("Todos los contactos");
  });
  it("una no general sin condiciones también dice «Todos los contactos»", () => {
    expect(filasDeSla([{ ...base, isDefault: false }])[0].aQuien).toBe("Todos los contactos");
  });
  it("los tiempos salen en frase", () => {
    expect(filasDeSla([base])[0].tiempos).toBe("Primer contacto en 15 min · reintento cada 60 min · sin dueño tras 24 h");
  });
});
