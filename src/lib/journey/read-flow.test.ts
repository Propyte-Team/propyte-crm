import { describe, it, expect } from "vitest";
import { draftToReadFlow, textoEspera } from "./read-flow";
import { draftToFlow, ruleToDraft, type RuleDraft, type Conditions } from "./rule-draft";

const base = (actions: RuleDraft["actions"], extra: Partial<RuleDraft> = {}): RuleDraft => ({
  name: "R", description: null, triggerType: "EVENT", triggerConfig: { eventType: "lead.captured" },
  conditions: {} as Conditions, actions, cooldownMinutes: null, priority: 1, isActive: true, ...extra,
});
const accion = (nodeId: string, extra: Record<string, unknown> = {}) => ({ nodeId, type: "CREATE_TASK", config: {}, ...extra });
const vacia = (branchId: string, extra: Record<string, unknown> = {}) => ({ branchId, conditions: {} as Conditions, steps: [] as RuleDraft["actions"], ...extra });
const ids = (f: { nodes: { id: string }[] }) => f.nodes.map((x) => x.id);
const aristas = (f: { edges: { source: string; target: string }[] }) => f.edges.map((x) => `${x.source}->${x.target}`);

describe("textoEspera", () => {
  it.each([
    [2880, "Esperar 2 días"], [1440, "Esperar 1 día"], [180, "Esperar 3 horas"], [60, "Esperar 1 hora"],
    [15, "Esperar 15 min"], [90, "Esperar 1 hora y 30 min"], [2160, "Esperar 1 día y 12 horas"],
  ])("%i min → %s", (min, texto) => expect(textoEspera(min)).toBe(texto));
});

describe("draftToReadFlow", () => {
  it("sin condiciones: Cuando → acciones, sin tarjeta «Si»", () => {
    const f = draftToReadFlow(base([accion("a0"), accion("a1")]));
    expect(ids(f)).toEqual(["trigger", "a0", "a1"]);
    expect(aristas(f)).toEqual(["trigger->a0", "a0->a1"]);
    expect(f.nodes[0].data.titulo).toBe("Cuando");
  });

  it("con condiciones agrega la tarjeta «Si» entre el disparador y los pasos", () => {
    const f = draftToReadFlow(base([accion("a0")], { conditions: { field: "contact.plaza", operator: "eq", value: "PDC" } as unknown as Conditions }));
    expect(ids(f)).toEqual(["trigger", "condition", "a0"]);
    expect(f.nodes[1].data.titulo).toBe("Si");
    expect(String(f.nodes[1].data.texto).length).toBeGreaterThan(3);
  });

  it("una acción con retraso lleva su espera antes, y el id de la acción no cambia", () => {
    const f = draftToReadFlow(base([accion("a0"), accion("a1", { delayMinutes: 2880 })]));
    expect(ids(f)).toEqual(["trigger", "a0", "a1~espera", "a1"]);
    expect(aristas(f)).toEqual(["trigger->a0", "a0->a1~espera", "a1~espera->a1"]);
    expect(f.nodes.find((x) => x.id === "a1~espera")?.data.texto).toBe("Esperar 2 días");
  });

  it("lee el retraso de config.delayMinutes como el motor", () => {
    const f = draftToReadFlow(base([accion("a0", { config: { delayMinutes: 180 } })]));
    expect(f.nodes.find((x) => x.type === "wait")?.data.texto).toBe("Esperar 3 horas");
  });

  it("no cambia draftToFlow: ahí no hay nodos de espera", () => {
    const d = base([accion("a0", { delayMinutes: 60 })]);
    expect(draftToFlow(d).nodes.some((x) => x.type === "wait")).toBe(false);
  });

  it("rama única con «si no»: aristas Sí / No", () => {
    const d = base([{
      nodeId: "a0", kind: "decision", branches: [{ ...vacia("a0.b0"), steps: [accion("a0.b0.0")] }],
      else: [accion("a0.else.0")],
    }]);
    const f = draftToReadFlow(d);
    expect(f.edges.filter((x) => x.source === "a0").map((x) => x.data?.label)).toEqual(["Sí", "No"]);
  });

  it("varias ramas: usa el nombre de cada una", () => {
    const d = base([{
      nodeId: "a0", kind: "decision",
      branches: [
        { ...vacia("a0.b0", { label: "Hot" }), steps: [accion("a0.b0.0")] },
        { ...vacia("a0.b1"), steps: [accion("a0.b1.0")] },
      ],
    }]);
    const f = draftToReadFlow(d);
    expect(f.edges.filter((x) => x.source === "a0").map((x) => x.data?.label)).toEqual(["Hot", "Rama 2"]);
    expect(f.edges.find((x) => x.target === "a0.b0.0")?.data?.branchId).toBe("a0.b0");
  });

  it("si hay pasos después de la decisión, las ramas se juntan en él", () => {
    const d = base([
      { nodeId: "a0", kind: "decision", branches: [{ ...vacia("a0.b0"), steps: [accion("a0.b0.0")] }], else: [accion("a0.else.0")] },
      accion("a1"),
    ]);
    const f = draftToReadFlow(d);
    expect(aristas(f)).toEqual(expect.arrayContaining(["a0.b0.0->a1", "a0.else.0->a1"]));
    expect(aristas(f)).not.toContain("a0->a1");
  });

  it("sin pasos después, no fuerza la unión", () => {
    const d = base([{ nodeId: "a0", kind: "decision", branches: [{ ...vacia("a0.b0"), steps: [accion("a0.b0.0")] }], else: [accion("a0.else.0")] }]);
    const f = draftToReadFlow(d);
    expect(ids(f)).toEqual(["trigger", "a0", "a0.b0.0", "a0.else.0"]);
  });

  it("rama vacía sin nada después: marcador «No hace nada» con su etiqueta", () => {
    const d = base([{ nodeId: "a0", kind: "decision", branches: [vacia("a0.b0")] }]);
    const f = draftToReadFlow(d);
    const marcador = f.nodes.find((x) => x.type === "empty");
    expect(marcador?.data.texto).toBe("No hace nada");
    expect(f.edges.find((x) => x.target === marcador!.id)?.data?.label).toBe("Sí");
  });

  it("rama vacía con pasos después: la línea va directo al paso común, con su etiqueta", () => {
    const d = base([
      { nodeId: "a0", kind: "decision", branches: [vacia("a0.b0"), { ...vacia("a0.b1", { label: "Otra" }), steps: [accion("a0.b1.0")] }] },
      accion("a1"),
    ]);
    const f = draftToReadFlow(d);
    expect(f.nodes.some((x) => x.type === "empty")).toBe(false);
    expect(f.edges.find((x) => x.source === "a0" && x.target === "a1")?.data?.label).toBe("Rama 1");
  });

  it("decisión anidada al final de una rama: sus salidas se juntan en el paso común", () => {
    const interna = {
      nodeId: "a0.b0.0", kind: "decision" as const,
      branches: [{ ...vacia("a0.b0.0.b0"), steps: [accion("a0.b0.0.b0.0")] }],
      else: [accion("a0.b0.0.else.0")],
    };
    const d = base([
      { nodeId: "a0", kind: "decision", branches: [{ ...vacia("a0.b0"), steps: [interna] }, { ...vacia("a0.b1"), steps: [accion("a0.b1.0")] }] },
      accion("a1"),
    ]);
    const f = draftToReadFlow(d);
    expect(aristas(f)).toEqual(expect.arrayContaining(["a0.b0.0.b0.0->a1", "a0.b0.0.else.0->a1", "a0.b1.0->a1"]));
    expect(new Set(f.edges.map((x) => x.id)).size).toBe(f.edges.length);
  });

  it("sin acciones: solo el disparador", () => {
    const f = draftToReadFlow(base([]));
    expect(ids(f)).toEqual(["trigger"]);
    expect(f.edges).toEqual([]);
  });
});

describe("espera del disparador", () => {
  it("WF4: «Esperar 2 días» entre el Cuando y el Si", () => {
    const draft = ruleToDraft({
      id: "r", name: "WF4", description: null, triggerType: "STAGE_CHANGE",
      triggerConfig: { toStage: "MEETING_COMPLETED", delayMinutes: 2880 },
      conditions: { all: [{ field: "deal.hasQuote", op: "eq", value: false }] } as never,
      actions: [{ type: "CREATE_TASK", config: { subject: "Enviar cotización" } }] as never,
      cooldownMinutes: null, priority: 1, isActive: true,
    });
    const f = draftToReadFlow(draft);
    const espera = f.nodes.find((n) => n.id === "trigger~espera");
    expect(espera?.data.texto).toBe("Esperar 2 días");
    expect(f.edges.some((e) => e.source === "trigger" && e.target === "trigger~espera")).toBe(true);
    expect(f.edges.some((e) => e.source === "trigger~espera" && e.target === "condition")).toBe(true);
  });
});
