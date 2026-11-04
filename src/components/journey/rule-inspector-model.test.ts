import { describe, it, expect } from "vitest";
import {
  contextoDeRegla, disparadorAlElegir, disparadorAlEditarValor, firmaDeConfig, minutosDeRetraso,
  opcionesDeTipoDeAccion, paletaDeAcciones, parcheDeConfig, problemasDeNodo, selectorDeDisparador,
  tituloDeRama, vistaDeAccion, vistaDeInspector, findNode,
} from "./rule-inspector-model";
import type { NodeDraft } from "@/lib/journey/rule-draft";

const accion = (nodeId: string, type: string, config: Record<string, unknown> = {}): NodeDraft => ({ nodeId, type, config });

describe("vistaDeInspector", () => {
  const decision: NodeDraft = {
    nodeId: "d", kind: "decision",
    branches: [{ branchId: "d.b0", conditions: {}, steps: [accion("d.b0.0", "NOTIFY")] }],
    else: [accion("d.else.0", "ADD_TAG")],
  };
  const acts = [accion("a0", "SEND_WHATSAPP"), decision];
  it("distingue nodos", () => {
    expect(vistaDeInspector(acts, "trigger")).toBe("disparador");
    expect(vistaDeInspector(acts, "condition")).toBe("condicion");
    expect(vistaDeInspector(acts, null)).toBe("regla");
    expect(vistaDeInspector(acts, "a0")).toBe("accion");
    expect(vistaDeInspector(acts, "d")).toBe("decision");
    expect(vistaDeInspector(acts, "d.b0.0")).toBe("accion");
    expect(vistaDeInspector(acts, "d.else.0")).toBe("accion");
    expect(vistaDeInspector(acts, "nope")).toBe("regla");
    expect(findNode(acts, "d.else.0")?.nodeId).toBe("d.else.0");
  });
});

describe("selectorDeDisparador", () => {
  it("evento del catalogo: sin campo y sin aviso", () => {
    const s = selectorDeDisparador("EVENT", { eventType: "lead.captured" });
    expect(s.key).toBe("lead.captured");
    expect(s.campo).toBeUndefined();
    expect(s.aviso).toBeNull();
  });
  it("solo ofrece activos; el actual proximamente se conserva con aviso", () => {
    const base = selectorDeDisparador("EVENT", { eventType: "lead.captured" });
    expect(base.grupos.flatMap((g) => g.opciones).some((o) => o.proximamente)).toBe(false);
    const s = selectorDeDisparador("EVENT", { eventType: "quote.opened" });
    const op = s.grupos.flatMap((g) => g.opciones).find((o) => o.key === "quote.opened");
    expect(op?.proximamente).toBe(true);
    expect(s.aviso).toBeTruthy();
  });
  it("evento desconocido se conserva con aviso", () => {
    const s = selectorDeDisparador("EVENT", { eventType: "algo.raro" });
    expect(s.grupos[s.grupos.length - 1].opciones[0].key).toBe("algo.raro");
    expect(s.aviso).toBeTruthy();
  });
  it("stage_change expone su campo y arma el guardado", () => {
    const s = selectorDeDisparador("STAGE_CHANGE", { toStage: "CLOSED_WON" });
    expect(s.key).toBe("stage_change");
    expect(s.campo?.kind).toBe("select");
    expect(s.valor).toBe("CLOSED_WON");
    const g = disparadorAlEditarValor("stage_change", "CLOSED_WON");
    expect(g.triggerType).toBe("STAGE_CHANGE");
    expect(g.triggerConfig).toMatchObject({ toStage: "CLOSED_WON" });
  });
  it("elegir un evento arma EVENT + eventType", () => {
    expect(disparadorAlElegir("deal.won")).toEqual({ triggerType: "EVENT", triggerConfig: { eventType: "deal.won" } });
  });
  it("contexto sale del disparador", () => {
    expect(contextoDeRegla("EVENT", { eventType: "deal.won" })).toBe("deal");
    expect(contextoDeRegla("EVENT", { eventType: "lead.captured" })).toBe("contact");
    expect(contextoDeRegla("EVENT", { eventType: "payment.overdue" })).toBe("event");
    expect(contextoDeRegla("EVENT", { eventType: "x.y" })).toBe("contact");
  });
});

describe("accion", () => {
  it("vista: titulo, campos del catalogo", () => {
    const v = vistaDeAccion({ nodeId: "a", type: "ADD_TAG", config: { tag: "vip" } });
    expect(v.titulo.length).toBeGreaterThan(0);
    expect(v.campos.map((c) => c.key)).toEqual(["tag"]);
    expect(v.desconocida).toBe(false);
  });
  it("tipo desconocido", () => {
    const v = vistaDeAccion({ nodeId: "a", type: "ZZZ", config: {} });
    expect(v.desconocida).toBe(true);
    expect(v.campos).toEqual([]);
  });
  it("problemas por campo requerido", () => {
    expect(problemasDeNodo({ nodeId: "a", type: "ADD_TAG", config: {} }).length).toBeGreaterThan(0);
    expect(problemasDeNodo({ nodeId: "a", type: "ADD_TAG", config: { tag: "x" } })).toEqual([]);
  });
  it("parche: numeros, borrados y claves desconocidas", () => {
    const cfg = { subject: "Hola", dueInMinutes: 60, extra: 1 };
    expect(parcheDeConfig("CREATE_TASK", cfg, { subject: "Hola", dueInMinutes: "120", extra: 1 })).toEqual({ dueInMinutes: 120 });
    const p = parcheDeConfig("CREATE_TASK", cfg, { subject: "", dueInMinutes: "60", extra: 1 });
    expect("subject" in p && p.subject === undefined).toBe(true);
    expect("extra" in p).toBe(false);
  });
  it("firma estable", () => {
    expect(firmaDeConfig({ b: 1, a: 2 })).toBe(firmaDeConfig({ a: 2, b: 1, c: undefined }));
    expect(firmaDeConfig(null)).toBe("{}");
  });
  it("retraso", () => {
    expect(minutosDeRetraso("")).toBe(0);
    expect(minutosDeRetraso("90")).toBe(90);
  });
  it("selector de tipos: agrupado y conserva el actual", () => {
    expect(opcionesDeTipoDeAccion("SEND_WHATSAPP").some((x) => x.grupo === "Actual")).toBe(false);
    const raro = opcionesDeTipoDeAccion("ZZZ");
    expect(raro[raro.length - 1].acciones[0].type).toBe("ZZZ");
  });
});

describe("ramas y paleta", () => {
  it("titulo de rama = frase de condiciones", () => {
    expect(tituloDeRama({ conditions: {} }, 0)).toBe("Rama 1: siempre");
    const t = tituloDeRama({ label: "VIP", conditions: { all: [{ field: "contact.temperature", op: "eq", value: "HOT" }] } }, 1);
    expect(t.startsWith("VIP: ")).toBe(true);
    expect(t).not.toMatch(/contact./);
  });
  it("paleta: solo activas, sin emoji", () => {
    const p = paletaDeAcciones();
    expect(p.length).toBeGreaterThan(0);
    for (const g of p) for (const i of g.items) expect(i.label).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
