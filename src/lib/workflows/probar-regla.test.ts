import { describe, it, expect } from "vitest";
import { probarRegla, eventoDeDisparador } from "./probar-regla";

const ctx = {
  contact: { score: 80, leadSource: "META_ADS", lifecycleStage: "LEAD", tags: ["vip"], doNotContact: false, targetPlaza: null },
  deal: null,
  event: { type: "lead.captured", payload: {} },
  context: { isBusinessHours: true },
};

const regla = {
  triggerType: "EVENT",
  triggerConfig: { eventType: "lead.captured" },
  conditions: { all: [{ field: "contact.leadSource", op: "eq", value: "META_ADS" }, { field: "contact.score", op: "gte", value: 90 }] },
  actions: [{ type: "update_score", config: { delta: 5 } }],
};

describe("probarRegla", () => {
  it("evento: lo dice y no juzga el disparador", () => {
    const r = probarRegla(regla, ctx);
    expect(r.disparador.aplica).toBeNull();
    expect(r.disparador.frase).toContain("Esta regla se activa cuando");
    expect(r.disparador.frase).toContain("así se evaluarían las condiciones ahora");
  });

  it("cada condición trae ✓/✗ y el valor actual en español", () => {
    const r = probarRegla(regla, ctx);
    expect(r.condiciones).toHaveLength(2);
    expect(r.condiciones[0].cumple).toBe(true);
    expect(r.condiciones[0].actual).not.toContain("META_ADS");
    expect(r.condiciones[1].cumple).toBe(false);
    expect(r.condiciones[1].actual).toBe("80");
    expect(r.condicionesCumplen).toBe(false);
    expect(r.correria).toBe(false);
    expect(r.veredicto).toMatch(/no se cumplen las condiciones/);
  });

  it("todo cumple → correría y lista las acciones en frase", () => {
    const r = probarRegla({ ...regla, conditions: { field: "contact.score", op: "gte", value: 50 } }, ctx);
    expect(r.correria).toBe(true);
    expect(r.acciones).toHaveLength(1);
    expect(r.acciones[0]).not.toMatch(/update_score/);
    expect(r.veredicto).toBe("Correría con este contacto.");
  });

  it("sin condiciones aplica siempre", () => {
    const r = probarRegla({ ...regla, conditions: {} }, ctx);
    expect(r.condiciones).toEqual([]);
    expect(r.condicionesCumplen).toBe(true);
    expect(r.correria).toBe(true);
  });

  it("dato ausente se lee «Sin dato»", () => {
    const r = probarRegla({ ...regla, conditions: { field: "contact.targetPlaza", op: "eq", value: "CANCUN" } }, ctx);
    expect(r.condiciones[0]).toMatchObject({ cumple: false, actual: "Sin dato" });
  });

  it("condición de negocio sin negocio: lo aclara", () => {
    const r = probarRegla({ ...regla, conditions: { field: "deal.stage", op: "eq", value: "WON" } }, ctx);
    expect(r.condiciones[0].actual).toMatch(/no tiene negocio/);
    expect(r.condiciones[0].cumple).toBe(false);
  });

  it("any: basta una hoja", () => {
    const r = probarRegla({ ...regla, conditions: { any: regla.conditions.all } }, ctx);
    expect(r.condicionesCumplen).toBe(true);
    expect(r.condiciones.map((c) => c.cumple)).toEqual([true, false]);
  });

  it("umbral de score: sí se puede juzgar con el estado actual", () => {
    const ok = probarRegla({ ...regla, triggerType: "SCORE_THRESHOLD", triggerConfig: { threshold: 70 }, conditions: {} }, ctx);
    expect(ok.disparador.aplica).toBe(true);
    const no = probarRegla({ ...regla, triggerType: "SCORE_THRESHOLD", triggerConfig: { threshold: 95 }, conditions: {} }, ctx);
    expect(no.disparador.aplica).toBe(false);
    expect(no.disparador.detalle).toContain("80");
    expect(no.correria).toBe(false);
    expect(no.veredicto).toMatch(/disparador/);
  });

  it("ciclo de vida: compara con la etapa actual", () => {
    const r = probarRegla({ ...regla, triggerType: "LIFECYCLE_CHANGE", triggerConfig: { toStage: "CLIENT" }, conditions: {} }, ctx);
    expect(r.disparador.aplica).toBe(false);
  });

  it("regla sin acciones: aplica pero lo avisa", () => {
    const r = probarRegla({ ...regla, conditions: {}, actions: [] }, ctx);
    expect(r.acciones).toEqual([]);
    expect(r.veredicto).toMatch(/no tiene acciones/);
  });

  it("no muta el contexto", () => {
    const copia = JSON.stringify(ctx);
    probarRegla(regla, ctx);
    expect(JSON.stringify(ctx)).toBe(copia);
  });
});

describe("eventoDeDisparador", () => {
  it("mapea cada tipo al evento que emite el motor", () => {
    expect(eventoDeDisparador({ triggerType: "EVENT", triggerConfig: { eventType: "lead.captured" } })).toBe("lead.captured");
    expect(eventoDeDisparador({ triggerType: "STAGE_CHANGE" })).toBe("deal.stage_changed");
    expect(eventoDeDisparador({ triggerType: "SCORE_THRESHOLD" })).toBe("contact.scored");
    expect(eventoDeDisparador({ triggerType: "INACTIVITY" })).toBeUndefined();
  });
});
