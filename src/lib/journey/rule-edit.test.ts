import { describe, it, expect } from "vitest";
import { workflowActionsSchema } from "@/lib/validations/rebuild-f1";
import {
  ruleToDraft, draftToRulePayload, isDecisionDraft, type RuleRow, type RuleDraft, type ActionNodeDraft,
  ubicarNodo, insertActionAt, insertDecisionAt, idDeNodoInsertado, puntoDeArista, esperaDeArista,
  minutosDeEspera, setEspera, conservarEsperaDeDisparador, removeNode,
} from "./rule-draft";
import { draftToReadFlow } from "./read-flow";

const BASE: RuleRow = {
  id: "r1",
  name: "Seguimiento de reunión",
  description: null,
  triggerType: "EVENT",
  triggerConfig: { eventType: "lead.captured" },
  conditions: {},
  actions: [
    { type: "SEND_WHATSAPP", config: { template: "bienvenida" } },
    {
      kind: "decision",
      label: "Por origen",
      branches: [
        { label: "Meta", conditions: { all: [{ field: "adAttribution.platform", op: "eq", value: "META" }] }, steps: [{ type: "ASSIGN", config: { mode: "ROUND_ROBIN" } }] },
        { conditions: { all: [{ field: "contact.score", op: "gte", value: 70 }] }, steps: [] },
      ],
      else: [],
    },
    { type: "CHANGE_STAGE", config: { toStage: "MQL" }, delayMinutes: 1440 },
  ] as never,
  cooldownMinutes: null,
  priority: 100,
  isActive: false,
};

const draft = (): RuleDraft => ruleToDraft(BASE);
const tipos = (d: RuleDraft) => d.actions.map((a) => (isDecisionDraft(a) ? "decision" : (a as ActionNodeDraft).type));
const valido = (d: RuleDraft) => workflowActionsSchema.safeParse(draftToRulePayload(d).actions).success;

describe("insertar en una posición del árbol", () => {
  it("al principio y al final de la lista principal", () => {
    const a = insertActionAt(draft(), { lista: { tipo: "raiz" }, indice: 0 }, "ADD_TAG");
    expect(tipos(a)).toEqual(["ADD_TAG", "SEND_WHATSAPP", "decision", "CHANGE_STAGE"]);
    const b = insertActionAt(draft(), { lista: { tipo: "raiz" }, indice: 99 }, "ADD_TAG");
    expect(tipos(b)).toEqual(["SEND_WHATSAPP", "decision", "CHANGE_STAGE", "ADD_TAG"]);
  });

  it("dentro de una rama con pasos y en una rama vacía", () => {
    const d = draft();
    const dec = d.actions[1];
    if (!isDecisionDraft(dec)) throw new Error("se esperaba decisión");
    const conPasos = insertActionAt(d, { lista: { tipo: "rama", branchId: dec.branches[0].branchId }, indice: 0 }, "ADD_TAG");
    const dec1 = conPasos.actions[1];
    if (!isDecisionDraft(dec1)) throw new Error("se esperaba decisión");
    expect(dec1.branches[0].steps.map((s) => (s as ActionNodeDraft).type)).toEqual(["ADD_TAG", "ASSIGN"]);

    const vacia = insertActionAt(d, { lista: { tipo: "rama", branchId: dec.branches[1].branchId }, indice: 0 }, "ADD_TAG");
    const dec2 = vacia.actions[1];
    if (!isDecisionDraft(dec2)) throw new Error("se esperaba decisión");
    expect(dec2.branches[1].steps).toHaveLength(1);
  });

  it("dentro del «si no» y reasigna los ids sin huecos", () => {
    const d = draft();
    const dec = d.actions[1];
    if (!isDecisionDraft(dec)) throw new Error("se esperaba decisión");
    const punto = { lista: { tipo: "else" as const, nodeId: dec.nodeId }, indice: 0 };
    const out = insertActionAt(d, punto, "ADD_TAG");
    const dec2 = out.actions[1];
    if (!isDecisionDraft(dec2)) throw new Error("se esperaba decisión");
    expect(dec2.else?.[0].nodeId).toBe("a1.else.0");
    expect(idDeNodoInsertado(punto)).toBe("a1.else.0");
    expect(ubicarNodo(out, "a1.else.0")).toEqual({ lista: { tipo: "else", nodeId: "a1" }, indice: 0 });
  });

  it("el id del nodo insertado coincide con el que queda en el árbol", () => {
    const d = draft();
    const dec = d.actions[1];
    if (!isDecisionDraft(dec)) throw new Error("se esperaba decisión");
    for (const punto of [
      { lista: { tipo: "raiz" as const }, indice: 1 },
      { lista: { tipo: "rama" as const, branchId: dec.branches[0].branchId }, indice: 1 },
    ]) {
      const out = insertActionAt(d, punto, "ADD_TAG");
      const n = ubicarNodo(out, idDeNodoInsertado(punto));
      expect(n).toEqual(punto);
    }
  });

  it("una decisión nueva entra con una rama vacía y queda anidable", () => {
    const d = insertDecisionAt(draft(), { lista: { tipo: "raiz" }, indice: 1 });
    expect(tipos(d)).toEqual(["SEND_WHATSAPP", "decision", "decision", "CHANGE_STAGE"]);
    const nueva = d.actions[1];
    if (!isDecisionDraft(nueva)) throw new Error("se esperaba decisión");
    expect(nueva.branches).toHaveLength(1);
    expect(nueva.branches[0].steps).toEqual([]);
  });

  it("ubicarNodo devuelve null si no existe", () => {
    expect(ubicarNodo(draft(), "zzz")).toBeNull();
  });
});

describe("puntoDeArista (de una línea del lienzo al lugar del árbol)", () => {
  const flow = draftToReadFlow(draft(), { edicion: true });
  const arista = (source: string, target: string) => {
    const e = flow.edges.find((x) => x.source === source && x.target === target);
    if (!e) throw new Error(`no hay línea ${source} -> ${target}`);
    return e;
  };

  it("desde el «Si» hasta el primer paso → al principio de la lista", () => {
    expect(puntoDeArista(draft(), arista("condition", "a0"))).toEqual({ lista: { tipo: "raiz" }, indice: 0 });
  });

  it("entre dos pasos → justo después del primero", () => {
    expect(puntoDeArista(draft(), arista("a0", "a1"))).toEqual({ lista: { tipo: "raiz" }, indice: 1 });
  });

  it("de la decisión a una rama → al principio de esa rama; a una rama vacía igual", () => {
    const d = draft();
    const dec = d.actions[1];
    if (!isDecisionDraft(dec)) throw new Error("se esperaba decisión");
    const aRama = flow.edges.find((e) => e.source === "a1" && (e.data as { branchId?: string })?.branchId === "a1.b0")!;
    expect(puntoDeArista(d, aRama)).toEqual({ lista: { tipo: "rama", branchId: "a1.b0" }, indice: 0 });
    const aVacia = flow.edges.find((e) => e.source === "a1" && (e.data as { branchId?: string })?.branchId === "a1.b1")!;
    expect(puntoDeArista(d, aVacia)).toEqual({ lista: { tipo: "rama", branchId: "a1.b1" }, indice: 0 });
    const aElse = flow.edges.find((e) => e.source === "a1" && (e.data as { branchId?: string })?.branchId === "a1.else")!;
    expect(puntoDeArista(d, aElse)).toEqual({ lista: { tipo: "else", nodeId: "a1" }, indice: 0 });
  });

  it("al final de una rama → después de su último paso, dentro de la rama", () => {
    const e = flow.edges.find((x) => x.source === "a1.b0.0")!;
    expect(puntoDeArista(draft(), e)).toEqual({ lista: { tipo: "rama", branchId: "a1.b0" }, indice: 1 });
  });

  it("al final de la regla (línea hacia «Fin») → después del último paso", () => {
    expect(puntoDeArista(draft(), arista("a2", "fin"))).toEqual({ lista: { tipo: "raiz" }, indice: 3 });
  });

  it("antes de una acción con espera → antes de esa acción (no entre la espera y la acción)", () => {
    const aEspera = flow.edges.find((e) => e.target === "a2~espera")!;
    expect(puntoDeArista(draft(), aEspera)).toEqual(puntoDeArista(draft(), { source: aEspera.source, target: "a2" }));
    expect(puntoDeArista(draft(), arista("a2~espera", "a2"))).toBeNull();
  });

  it("la línea que entra al «Si» no admite inserciones", () => {
    expect(puntoDeArista(draft(), arista("trigger", "condition"))).toBeNull();
  });

  it("una regla sin pasos: del «Si» a «Fin» inserta en la lista principal", () => {
    const vacia: RuleDraft = { ...draft(), actions: [] };
    const f = draftToReadFlow(vacia, { edicion: true });
    const e = f.edges.find((x) => x.target === "fin")!;
    expect(puntoDeArista(vacia, e)).toEqual({ lista: { tipo: "raiz" }, indice: 0 });
  });

  it("toda línea del lienzo de edición que admite inserción produce un árbol válido para el servidor", () => {
    const d = draft();
    for (const e of flow.edges) {
      const p = puntoDeArista(d, e);
      if (!p) continue;
      expect(valido(insertActionAt(d, p, "ADD_TAG"))).toBe(true);
      expect(valido(insertDecisionAt(d, p))).toBe(true);
    }
  });
});

describe("esperas", () => {
  const flow = draftToReadFlow(draft(), { edicion: true });

  it("desde el disparador se guarda en el disparador", () => {
    const e = flow.edges.find((x) => x.source === "trigger")!;
    expect(esperaDeArista(draft(), e)).toEqual({ ok: true, objetivo: "trigger" });
    const d = setEspera(draft(), "trigger", 2880);
    expect(d.triggerConfig).toEqual({ eventType: "lead.captured", delayMinutes: 2880 });
    expect(minutosDeEspera(d, "trigger")).toBe(2880);
  });

  it("entre pasos se guarda en la acción que viene después", () => {
    const e = flow.edges.find((x) => x.source === "condition")!;
    expect(esperaDeArista(draft(), e)).toEqual({ ok: true, objetivo: "a0" });
    const d = setEspera(draft(), "a0", 60);
    expect((d.actions[0] as ActionNodeDraft).delayMinutes).toBe(60);
    expect(draftToRulePayload(d).actions[0]).toEqual({ type: "SEND_WHATSAPP", config: { template: "bienvenida" }, delayMinutes: 60 });
  });

  it("si lo que sigue es una decisión, una rama vacía o el final, no hay dónde guardarla", () => {
    const aDecision = flow.edges.find((x) => x.source === "a0" && x.target === "a1")!;
    const r1 = esperaDeArista(draft(), aDecision);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.motivo).toMatch(/acción/);
    const aFin = flow.edges.find((x) => x.target === "fin")!;
    expect(esperaDeArista(draft(), aFin).ok).toBe(false);
    const aVacia = flow.edges.find((x) => x.source === "a1" && (x.data as { branchId?: string })?.branchId === "a1.b1")!;
    expect(esperaDeArista(draft(), aVacia).ok).toBe(false);
    const aPrimeroDeRama = flow.edges.find((x) => x.source === "a1" && (x.data as { branchId?: string })?.branchId === "a1.b0")!;
    expect(esperaDeArista(draft(), aPrimeroDeRama)).toEqual({ ok: true, objetivo: "a1.b0.0" });
  });

  it("quitar la espera borra la propiedad (no deja 0)", () => {
    const d = setEspera(draft(), "a2", 0);
    expect("delayMinutes" in (d.actions[2] as ActionNodeDraft)).toBe(false);
    expect(minutosDeEspera(d, "a2")).toBe(0);
    const t = setEspera(setEspera(draft(), "trigger", 30), "trigger", 0);
    expect(t.triggerConfig).toEqual({ eventType: "lead.captured" });
  });

  it("si la espera vivía en config.delayMinutes (como el seed), se mueve al nivel de la acción", () => {
    const d = ruleToDraft({ ...BASE, actions: [{ type: "NOTIFY", config: { to: "assignee", delayMinutes: 2880 } }] as never });
    expect(minutosDeEspera(d, "a0")).toBe(2880);
    const out = setEspera(d, "a0", 60);
    expect(draftToRulePayload(out).actions[0]).toEqual({ type: "NOTIFY", config: { to: "assignee" }, delayMinutes: 60 });
  });

  it("la espera del lienzo coincide con lo que dibuja: el nodo de espera aparece tras ponerla", () => {
    const d = setEspera(draft(), "a0", 120);
    const f = draftToReadFlow(d, { edicion: true });
    const espera = f.nodes.find((n) => n.id === "a0~espera");
    expect(espera?.data.texto).toBe("Esperar 2 horas");
  });

  it("cambiar de disparador conserva la espera", () => {
    expect(conservarEsperaDeDisparador({ eventType: "a", delayMinutes: 60 }, { eventType: "b" })).toEqual({ eventType: "b", delayMinutes: 60 });
    expect(conservarEsperaDeDisparador({ eventType: "a" }, { eventType: "b" })).toEqual({ eventType: "b" });
  });
});

describe("round-trip borrador → payload tras editar", () => {
  it("insertar acción, espera y decisión produce un payload que el servidor acepta y que se relee igual", () => {
    let d = draft();
    d = insertActionAt(d, { lista: { tipo: "raiz" }, indice: 1 }, "ADD_TAG");
    d = setEspera(d, "a1", 4320);
    d = insertDecisionAt(d, { lista: { tipo: "rama", branchId: "a2.b1" }, indice: 0 });
    const payload = draftToRulePayload(d);
    expect(workflowActionsSchema.safeParse(payload.actions).success).toBe(true);
    expect(payload.actions[1]).toEqual({ type: "ADD_TAG", config: {}, delayMinutes: 4320 });
    // Releer el payload da el mismo árbol y el mismo payload.
    const relido = ruleToDraft({ ...payload, id: "r1" } as RuleRow);
    expect(draftToRulePayload(relido)).toEqual(payload);
  });

  it("quitar el paso insertado devuelve el payload original", () => {
    const original = draftToRulePayload(draft());
    let d = insertActionAt(draft(), { lista: { tipo: "raiz" }, indice: 1 }, "ADD_TAG");
    d = removeNode(d, "a1");
    expect(draftToRulePayload(d)).toEqual(original);
  });
});

describe("draftToReadFlow en modo edición", () => {
  it("siempre trae el «Si» y un «Fin» que recoge los finales", () => {
    const f = draftToReadFlow(draft(), { edicion: true });
    expect(f.nodes.find((n) => n.id === "condition")?.data.texto).toBe("Sin condiciones: aplica siempre");
    expect(f.nodes.some((n) => n.id === "fin")).toBe(true);
    expect(f.edges.filter((e) => e.target === "fin").map((e) => e.source)).toEqual(["a2"]);
  });

  it("modo lectura no cambia: sin «Si» vacío ni «Fin»", () => {
    const f = draftToReadFlow(draft());
    expect(f.nodes.some((n) => n.id === "condition" || n.id === "fin")).toBe(false);
  });

  it("si la regla termina en una decisión, cada final de rama llega a «Fin»", () => {
    const d: RuleDraft = { ...draft(), actions: draft().actions.slice(0, 2) };
    const f = draftToReadFlow(d, { edicion: true });
    const haciaFin = f.edges.filter((e) => e.target === "fin").map((e) => e.source);
    expect(haciaFin).toEqual(["a1.b0.0"]);
  });
});
