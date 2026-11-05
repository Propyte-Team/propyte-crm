import { describe, it, expect } from "vitest";
import { newRuleDraft, insertActionAt, insertDecisionAt, setActionConfig, setBranchConditions, setMeta, setTrigger, type RuleDraft } from "./rule-draft";
import { textoCorto, validarBorrador } from "./rule-validation";

const base = (): RuleDraft => newRuleDraft();

describe("validarBorrador", () => {
  it("la regla nueva (nombre, disparador y etapa completos) es válida", () => {
    const r = validarBorrador(base());
    expect(r.ok).toBe(true);
    expect(r.porNodo).toEqual({});
    expect(r.faltantes).toEqual([]);
  });

  it("acción con un campo obligatorio vacío: el paso dice «Falta …» y el resumen lo nombra", () => {
    const d = insertActionAt(base(), { lista: { tipo: "raiz" }, indice: 1 }, "SEND_WHATSAPP");
    const r = validarBorrador(d);
    expect(r.ok).toBe(false);
    expect(r.porNodo.a1).toMatch(/^Falta /);
    expect(r.porNodo.a0).toBeUndefined();
    expect(r.faltantes[0]).toMatch(/^WhatsApp: Falta /);
  });

  it("se corrige al llenar el campo", () => {
    let d = insertActionAt(base(), { lista: { tipo: "raiz" }, indice: 1 }, "SEND_WHATSAPP");
    d = setActionConfig(d, "a1", { template: "bienvenida" });
    expect(validarBorrador(d).ok).toBe(true);
  });

  it("revisa también las acciones dentro de ramas y del «si no»", () => {
    let d = insertDecisionAt(base(), { lista: { tipo: "raiz" }, indice: 1 });
    d = insertActionAt(d, { lista: { tipo: "rama", branchId: "a1.b0" }, indice: 0 }, "ADD_TAG");
    const r = validarBorrador(d);
    expect(r.ok).toBe(false);
    expect(r.porNodo["a1.b0.0"]).toMatch(/^Falta /);
  });

  it("nombre muy corto bloquea y aparece en el resumen", () => {
    const r = validarBorrador(setMeta(base(), { name: "ab" }));
    expect(r.ok).toBe(false);
    expect(r.faltantes.join(" ")).toMatch(/Nombre/);
  });

  it("regla sin pasos no es válida", () => {
    const r = validarBorrador({ ...base(), actions: [] });
    expect(r.ok).toBe(false);
    expect(r.faltantes).toContain("Agrega al menos un paso a la regla");
  });

  it("disparador que pide un valor y no lo tiene se marca en el disparador", () => {
    const d = setTrigger(base(), { triggerType: "SCORE_THRESHOLD", triggerConfig: {} });
    const r = validarBorrador(d);
    expect(r.ok).toBe(false);
    expect(r.porNodo.trigger).toBeTruthy();
  });

  it("condición con hoja a medias se marca en el «Si»", () => {
    const d: RuleDraft = { ...base(), conditions: { all: [{ field: "", op: "eq", value: "x" }] } as never };
    const r = validarBorrador(d);
    expect(r.ok).toBe(false);
    expect(r.porNodo.condition).toBeTruthy();
  });

  it("condición de una rama a medias se marca en la decisión", () => {
    let d = insertDecisionAt(base(), { lista: { tipo: "raiz" }, indice: 1 });
    d = setBranchConditions(d, "a1.b0", { all: [{ field: "", op: "eq", value: "x" }] } as never);
    const r = validarBorrador(d);
    expect(r.porNodo.a1).toMatch(/Rama 1/);
  });
});

describe("textoCorto", () => {
  it("quita el prefijo del nombre de la acción y pone mayúscula", () => {
    expect(textoCorto("Enviar WhatsApp: falta elegir una plantilla")).toBe("Falta elegir una plantilla");
  });
  it("no recorta frases sin prefijo", () => {
    expect(textoCorto("Falta elegir el disparador")).toBe("Falta elegir el disparador");
  });
});
