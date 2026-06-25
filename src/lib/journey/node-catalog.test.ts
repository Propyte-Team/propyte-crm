import { describe, it, expect } from "vitest";
import { workflowActionTypes } from "@/lib/validations/rebuild-f1";
import { NODE_CATALOG, paletteGroups, metaFor, labelFor, summaryFor, fieldDefsFor } from "./node-catalog";

describe("node-catalog", () => {
  it("cubre todos los workflowActionTypes con categoría y label", () => {
    for (const t of workflowActionTypes) {
      const m = metaFor(t);
      expect(m, `falta meta para ${t}`).toBeTruthy();
      expect(m!.category).toBeTruthy();
      expect(m!.label.length).toBeGreaterThan(0);
    }
    expect(NODE_CATALOG.length).toBe(workflowActionTypes.length);
  });

  it("los tipos comunes tienen fields con configKey no vacío", () => {
    for (const t of ["SEND_WHATSAPP", "CREATE_TASK", "ADD_TAG", "CHANGE_STAGE", "SET_LIFECYCLE", "NOTIFY", "ASSIGN", "UPDATE_FIELD", "ESCALATE"]) {
      const defs = fieldDefsFor(t);
      expect(defs.length, `sin fields ${t}`).toBeGreaterThan(0);
      for (const d of defs) expect(d.configKey.length).toBeGreaterThan(0);
    }
  });

  it("CHANGE_STAGE usa etapas de pipeline; SET_LIFECYCLE usa lifecycle", () => {
    const cs = fieldDefsFor("CHANGE_STAGE")[0];
    expect(cs.options?.some((o) => o.value === "NEW_LEAD")).toBe(true);
    const sl = fieldDefsFor("SET_LIFECYCLE")[0];
    expect(sl.options?.some((o) => o.value === "MQL")).toBe(true);
  });

  it("labelFor cae al enum si no hay meta; summaryFor arma 'label · valor'", () => {
    expect(labelFor("SEND_WHATSAPP")).toContain("WhatsApp");
    expect(labelFor("DESCONOCIDO")).toBe("DESCONOCIDO");
    expect(summaryFor("SEND_WHATSAPP", { template: "bienvenida" })).toBe("💬 WhatsApp · bienvenida");
    expect(summaryFor("SEND_WHATSAPP", {})).toBe("💬 WhatsApp");
  });

  it("paletteGroups agrupa por categoría sin perder tipos", () => {
    const total = paletteGroups().reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(workflowActionTypes.length);
  });
});
