import { describe, it, expect } from "vitest";
import {
  inputDeCampo, rawDesdeConfig, opcionesDeFuente, opcionesDeInput, cambiarRaw, accionDesdeRaw,
  accionesAgrupadas, valorDeSelect, VALOR_OTRO, retrasoDesdeTexto, retrasoATexto, accionNueva,
  type ListasDeFuentes,
} from "./action-card-model";
import { camposVisibles, ACCIONES } from "@/lib/workflows/action-catalog";

const listas: ListasDeFuentes = {
  plantillas: [
    { id: "w1", nombre: "Bienvenida", canal: "WHATSAPP" },
    { id: "e1", nombre: "Correo bienvenida", canal: "EMAIL" },
  ],
  cadencias: [{ id: "c1", nombre: "Seguimiento 7 días" }],
  usuarios: [{ id: "u1", nombre: "Ana", rol: "ADVISOR" }],
};
const campo = (type: string, key: string) => camposVisibles(type).find((c) => c.key === key)!;

describe("inputDeCampo", () => {
  it("number con unidad min usa minutos", () => {
    expect(inputDeCampo(campo("CREATE_TASK", "dueInMinutes"))).toBe("minutos");
    expect(inputDeCampo(campo("SEND_WHATSAPP", "body"))).toBe("textarea");
    expect(inputDeCampo(campo("SET_LIFECYCLE", "allowBackward"))).toBe("checkbox");
    expect(inputDeCampo(campo("ENROLL_PLAN", "planId"))).toBe("fuente");
  });
});

describe("opcionesDeFuente", () => {
  it("filtra plantillas por canal", () => {
    expect(opcionesDeFuente("plantillas_whatsapp", listas)).toEqual([{ value: "w1", label: "Bienvenida" }]);
    expect(opcionesDeFuente("plantillas_email", listas)).toEqual([{ value: "e1", label: "Correo bienvenida" }]);
    expect(opcionesDeFuente("cadencias", listas)).toEqual([{ value: "c1", label: "Seguimiento 7 días" }]);
    expect(opcionesDeFuente("usuarios", listas)).toEqual([{ value: "u1", label: "Ana" }]);
    expect(opcionesDeFuente("etapas", listas)).toEqual([]);
  });
});

describe("opcionesDeInput / valorDeSelect", () => {
  it("marca un valor guardado fuera de la lista", () => {
    const r = opcionesDeInput(campo("SEND_WHATSAPP", "template"), { template: "bienvenida_es" }, listas);
    expect(r.valorFueraDeLista).toBe("bienvenida_es");
    const ok = opcionesDeInput(campo("SEND_WHATSAPP", "template"), { template: "w1" }, listas);
    expect(ok.valorFueraDeLista).toBeNull();
  });
  it("permiteOtro con valor libre → Otro; sin permiteOtro muestra el valor", () => {
    const goal = campo("AI_REPLY", "goal");
    expect(goal.permiteOtro).toBe(true);
    expect(valorDeSelect(goal, { goal: "algo raro" }, listas, false)).toBe(VALOR_OTRO);
    expect(valorDeSelect(goal, {}, listas, true)).toBe(VALOR_OTRO);
    expect(valorDeSelect(campo("ENROLL_PLAN", "planId"), { planId: "xx" }, listas, false)).toBe("xx");
    expect(valorDeSelect(campo("ENROLL_PLAN", "planId"), { planId: "c1" }, listas, false)).toBe("c1");
  });
  it("opciones dependientes de otro campo", () => {
    const value = campo("UPDATE_FIELD", "value");
    const a = opcionesDeInput(value, { field: "urgency" }, listas).opciones;
    const b = opcionesDeInput(value, {}, listas).opciones;
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual([]);
  });
});

describe("raw ↔ config", () => {
  it("rawDesdeConfig pasa números a texto y conserva claves extra", () => {
    expect(rawDesdeConfig({ dueInMinutes: 60, strategy: "x", allowBackward: true })).toEqual({ dueInMinutes: "60", strategy: "x", allowBackward: true });
    expect(rawDesdeConfig(null)).toEqual({});
  });
  it("ida y vuelta no pierde claves que el catálogo no conoce", () => {
    const cfg = { subject: "Llamar", dueInMinutes: 90, useMatching: true };
    const a = accionDesdeRaw("CREATE_TASK", rawDesdeConfig(cfg));
    expect(a.config).toEqual(cfg);
  });
  it("accionDesdeRaw convierte tipos y poda vacíos", () => {
    const a = accionDesdeRaw("CREATE_TASK", { subject: " Hola ", dueInMinutes: "30", description: "" }, 15);
    expect(a).toEqual({ type: "CREATE_TASK", config: { subject: "Hola", dueInMinutes: 30 }, delayMinutes: 15 });
    expect(accionDesdeRaw("ADD_TAG", { tag: "x" }, 0).delayMinutes).toBeUndefined();
  });
  it("cambiarRaw limpia el campo que depende", () => {
    const n = cambiarRaw("UPDATE_FIELD", { field: "urgency", value: "ALTA" }, "field", "temperature");
    expect(n).toEqual({ field: "temperature" });
    expect(cambiarRaw("ADD_TAG", { tag: "a" }, "tag", "b")).toEqual({ tag: "b" });
  });
});

describe("retraso", () => {
  it("texto ↔ minutos", () => {
    expect(retrasoDesdeTexto("")).toBeUndefined();
    expect(retrasoDesdeTexto("0")).toBeUndefined();
    expect(retrasoDesdeTexto("90")).toBe(90);
    expect(retrasoATexto(undefined)).toBe("");
    expect(retrasoATexto(60)).toBe("60");
  });
});

describe("accionesAgrupadas / accionNueva", () => {
  it("solo ofrece acciones activas", () => {
    const tipos = accionesAgrupadas().flatMap((g) => g.acciones.map((a) => a.type));
    const prox = ACCIONES.filter((a) => a.estado === "proximamente").map((a) => a.type);
    for (const t of prox) expect(tipos).not.toContain(t);
    expect(tipos).toContain("SEND_WHATSAPP");
  });
  it("accionNueva trae config vacía", () => {
    expect(accionNueva("ASSIGN")).toEqual({ type: "ASSIGN", config: {} });
  });
});
