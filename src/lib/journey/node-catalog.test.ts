import { describe, it, expect } from "vitest";
import { workflowActionTypes, TRIGGER_TYPES } from "@/lib/validations/rebuild-f1";
import { NODE_CATALOG, paletteGroups, metaFor, labelFor, summaryFor, fieldDefsFor } from "./node-catalog";
import { TRIGGER_CATALOG, triggerLabelFor, coerceFieldConfig } from "./node-catalog";

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

  // sub-task 2 (unificación de catálogos): estos tipos hoy no tienen fields en NODE_CATALOG,
  // pero el WorkflowBuilder (form plano) sí les renderiza un campo. Al derivar el builder de
  // este catálogo, si falta la definición aquí el campo desaparecería del form → data loss.
  it("MAKE_CALL/ENROLL_PLAN/AI_*/WEBHOOK tienen al menos un field (paridad con el form plano)", () => {
    for (const t of ["MAKE_CALL", "ENROLL_PLAN", "AI_DRAFT", "AI_REPLY", "AI_CALL_SUMMARY", "WEBHOOK"]) {
      expect(fieldDefsFor(t).length, `sin fields ${t}`).toBeGreaterThan(0);
    }
  });
});

describe("TRIGGER_CATALOG (labels de disparador — sub-task 2)", () => {
  it("cubre todos los TRIGGER_TYPES compartidos con label no vacío", () => {
    for (const t of TRIGGER_TYPES) {
      const meta = TRIGGER_CATALOG.find((m) => m.type === t);
      expect(meta, `falta TRIGGER_CATALOG para ${t}`).toBeTruthy();
      expect(meta!.label.length).toBeGreaterThan(0);
    }
  });
  it("triggerLabelFor da un label humano para LIFECYCLE_CHANGE (no el enum crudo)", () => {
    const label = triggerLabelFor("LIFECYCLE_CHANGE");
    expect(label).not.toBe("LIFECYCLE_CHANGE");
    expect(label.length).toBeGreaterThan(0);
  });
  it("triggerLabelFor cae al tipo crudo si no hay meta", () => {
    expect(triggerLabelFor("DESCONOCIDO")).toBe("DESCONOCIDO");
  });
});

describe("coerceFieldConfig (adapter de tipos por FieldKind — sub-task 2)", () => {
  it("convierte un field kind:number de string a number", () => {
    const r = coerceFieldConfig("CREATE_TASK", { subject: "Llamar", dueInMinutes: "120" });
    expect(r.dueInMinutes).toBe(120);
    expect(r.subject).toBe("Llamar");
  });
  it("convierte un field kind:checkbox de string 'true'/'false' a boolean", () => {
    const r = coerceFieldConfig("SET_LIFECYCLE", { toStage: "MQL", allowBackward: "true" });
    expect(r.allowBackward).toBe(true);
    expect(r.toStage).toBe("MQL");
    const r2 = coerceFieldConfig("SET_LIFECYCLE", { toStage: "MQL", allowBackward: "false" });
    expect(r2.allowBackward).toBe(false);
  });
  it("deja los demás kinds (text/select/textarea) sin tocar y no truena si faltan valores", () => {
    const r = coerceFieldConfig("ADD_TAG", { tag: "vip" });
    expect(r).toEqual({ tag: "vip" });
    expect(coerceFieldConfig("CREATE_TASK", {})).toEqual({});
  });
});
