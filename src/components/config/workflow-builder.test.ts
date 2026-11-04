// Guards de consistencia del builder visual de reglas (cluster "workflow-builder
// consistency"). Sin @testing-library/react/jsdom en este repo (no hay .test.tsx
// existentes) — cubrimos el contrato vía los exports puros del módulo, igual que
// el resto del repo prueba lógica de UI a través de módulos puros (builder-model,
// node-catalog) en vez de renderizar componentes.
import { describe, it, expect } from "vitest";
import { workflowActionTypes, TRIGGER_TYPES } from "@/lib/validations/rebuild-f1";
import {
  shouldGuardRule, disparadoresAgrupados, borradorDesdeRegla, borradorNuevo, borradorDesdePlantilla, payloadDeBorrador,
  fusionarAccion, moverAccion, quitarAccion, validarBorrador, fraseDeBorrador, cambiarDisparador, contextoDeDisparador,
  avisoDeDisparador, armarDisparadorDeBorrador, indiceAbiertoTrasMover, indiceAbiertoTrasQuitar, jsonDeSoloLectura,
  problemasPorCampo, fraseDePlantilla,
} from "./workflow-builder-model";
import { CANONICAL_RULES } from "@/lib/workflows/canonical-rules.fixture";
import { RULE_TEMPLATES } from "@/lib/workflows/builder-templates";
import { ACCIONES } from "@/lib/workflows/action-catalog";
import { DISPARADORES } from "@/lib/workflows/trigger-catalog";
import { accionesAgrupadas } from "./action-card-model";
import { formatMinutes, mensajeAutomatizacion } from "./cadence-editor";
import { slaSummary } from "./sla-policy-editor";

describe("el constructor se deriva de los catálogos (sin mapas duplicados)", () => {
  // Antes se probaban BUILDER_ACTION_TYPES/FIELDS/TRIGGER_TYPES; E3 los eliminó porque el
  // constructor ya no tiene listas propias: lee action-catalog y trigger-catalog. El mismo
  // contrato se verifica ahora contra esos catálogos.
  it("las acciones ofrecidas + las próximamente cubren exactamente workflowActionTypes", () => {
    expect(ACCIONES.map((a) => a.type).sort()).toEqual([...workflowActionTypes].sort());
    const ofrecidas = accionesAgrupadas().flatMap((g) => g.acciones.map((a) => a.type));
    for (const t of ofrecidas) expect(workflowActionTypes as readonly string[]).toContain(t);
  });
  it("los disparadores cubren todos los TriggerType compartidos", () => {
    const tipos = new Set(DISPARADORES.map((d) => d.triggerType));
    // TIME se retiró del catálogo (el motor no lo ejecuta).
    for (const t of TRIGGER_TYPES.filter((x) => x !== "TIME")) expect(tipos.has(t)).toBe(true);
  });
  it("disparadoresAgrupados solo ofrece activos, más el actual aunque sea próximamente", () => {
    const claves = (k: string) => disparadoresAgrupados(k).flatMap((g) => g.disparadores.map((d) => d.key));
    expect(claves("lead.captured")).not.toContain("behavioral");
    expect(claves("behavioral")).toContain("behavioral");
    expect(claves("lead.captured")).toContain("lead.captured");
  });
});

describe("shouldGuardRule — guard anti data-loss de nodos de decisión (sub-task 3)", () => {
  it("una regla con nodo kind:'decision' queda en estado guardado (no se puede aplanar)", () => {
    const rule = {
      id: "r1",
      actions: [{ kind: "decision", branches: [{ conditions: {}, steps: [{ type: "ASSIGN", config: {} }] }] }],
    };
    expect(shouldGuardRule(rule)).toBe(true);
  });
  it("una regla simple (flat) NO queda guardada — funciona como siempre", () => {
    const rule = { id: "r2", actions: [{ type: "ADD_TAG", config: { tag: "x" } }] };
    expect(shouldGuardRule(rule)).toBe(false);
  });
  it("una regla nueva (sin actions/undefined) NO queda guardada", () => {
    expect(shouldGuardRule(undefined)).toBe(false);
    expect(shouldGuardRule({})).toBe(false);
  });
});

describe("helpers de idioma de negocio (E1)", () => {
  it("formatMinutes convierte minutos a texto legible", () => {
    expect(formatMinutes(0)).toBe("Inmediato");
    expect(formatMinutes(15)).toBe("15 min");
    expect(formatMinutes(180)).toBe("3 h");
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(formatMinutes(1440)).toBe("1 día");
    expect(formatMinutes(2880)).toBe("2 días");
    expect(formatMinutes(1500)).toBe("1 día 1 h");
  });
  it("mensajeAutomatizacion pinta errores por campo con nombres en español", () => {
    const msg = mensajeAutomatizacion({ error: { formErrors: [], fieldErrors: { name: ["Too small: expected string to have >=3 characters"], cooldownMinutes: ["Invalid input"] } } });
    expect(msg).toContain("Nombre: Debe tener al menos 3 caracteres");
    expect(msg).toContain("Plazo para no repetir");
    expect(mensajeAutomatizacion({ error: "Sin permiso" })).toBe("Sin permiso");
  });
  it("slaSummary resume los tiempos de una política", () => {
    expect(slaSummary(15, 60, 24)).toBe("Contactar en 15 min · recordar cada 1 h · reasignar a las 24 h");
  });
});


describe("workflow-builder-model: armar y parsear una regla completa", () => {
  const guardar = (r: (typeof CANONICAL_RULES)[number]) => payloadDeBorrador(borradorDesdeRegla(r), { activate: true });

  it("las 8 reglas canónicas hacen ida y vuelta sin perder lo que el motor lee", () => {
    for (const r of CANONICAL_RULES) {
      const p = guardar(r);
      expect(p.triggerType).toBe(r.triggerType);
      expect(p.triggerConfig).toEqual(r.triggerConfig);
      expect(p.actions).toEqual(r.actions);
      expect(p.conditions).toEqual(r.conditions);
    }
  });

  it("conserva claves extra del disparador (INACTIVITY.field) al editar las horas", () => {
    const wf3 = CANONICAL_RULES.find((r) => r.name === "WF3")!;
    const b = borradorDesdeRegla(wf3);
    expect(b.triggerKey).toBe("inactivity");
    const p = payloadDeBorrador({ ...b, triggerValue: "48" }, { activate: false });
    expect(p.triggerConfig).toEqual({ hours: 48, field: "contact.lastActivityAt" });
  });

  it("al cambiar de disparador no arrastra la config del anterior", () => {
    const wf3 = borradorDesdeRegla(CANONICAL_RULES.find((r) => r.name === "WF3")!);
    const b = cambiarDisparador(wf3, "lead.captured");
    expect(b.triggerValue).toBe("");
    expect(armarDisparadorDeBorrador(b)).toEqual({ triggerType: "EVENT", triggerConfig: { eventType: "lead.captured" } });
  });

  it("un disparador fuera del catálogo que no se toca se guarda tal cual", () => {
    const raro = { name: "X1", triggerType: "EVENT", triggerConfig: { eventType: "algo.raro", extra: 1 }, actions: [{ type: "ADD_TAG", config: { tag: "a" } }] };
    const p = payloadDeBorrador(borradorDesdeRegla(raro), { activate: false });
    expect(p.triggerConfig).toEqual({ eventType: "algo.raro", extra: 1 });
    expect(validarBorrador(borradorDesdeRegla(raro)).filter((x) => x.campo === "trigger")).toEqual([]);
  });

  it("fusionarAccion conserva autonomyLevel y quita el retraso al ponerlo inmediato", () => {
    const wf1 = borradorDesdeRegla(CANONICAL_RULES[0]);
    const ia = wf1.actions[1];
    expect(ia.autonomyLevel).toBe("L2");
    const con = fusionarAccion(ia, { type: "AI_REPLY", config: { ...ia.config, goal: "x" }, delayMinutes: 15 });
    expect(con).toMatchObject({ autonomyLevel: "L2", delayMinutes: 15, config: { channel: "WHATSAPP", goal: "x" } });
    const sin = fusionarAccion(con, { type: "AI_REPLY", config: con.config });
    expect("delayMinutes" in sin).toBe(false);
    expect(sin.autonomyLevel).toBe("L2");
  });

  it("la frase de WF1 se lee en español sin claves crudas", () => {
    const f = fraseDeBorrador(borradorDesdeRegla(CANONICAL_RULES[0]));
    expect(f.startsWith("Cuando entra un lead · si fuente es")).toBe(true);
    expect(f).toContain("entonces asignar asesor →");
    expect(f).not.toMatch(/lead\.captured|AI_REPLY|ASSIGN/);
  });

  it("payload: prioridad por defecto, cooldown nulo y trim de nombre", () => {
    const b = { ...borradorDesdeRegla(CANONICAL_RULES[0]), name: "  Mi regla ", priority: "", cooldown: "" };
    const p = payloadDeBorrador(b, { id: "r1", activate: false });
    expect(p).toMatchObject({ id: "r1", name: "Mi regla", priority: 100, cooldownMinutes: null, isActive: false, description: null });
    expect(payloadDeBorrador({ ...b, cooldown: "1440" }, { activate: true }).cooldownMinutes).toBe(1440);
  });

  it("jsonDeSoloLectura es JSON válido con actions y conditions", () => {
    const j = JSON.parse(jsonDeSoloLectura(borradorDesdeRegla(CANONICAL_RULES[0])));
    expect(Object.keys(j)).toEqual(["triggerType", "triggerConfig", "conditions", "actions"]);
  });
});

describe("workflow-builder-model: validación y disparadores", () => {
  it("una regla nueva vacía pide nombre y acción", () => {
    const p = problemasPorCampo(validarBorrador(borradorNuevo()));
    expect(p.name).toBeTruthy();
    expect(p.actions).toContain("Agrega al menos una acción.");
  });
  it("valida acciones con su número y condiciones a medias", () => {
    const b = { ...borradorNuevo(), name: "Regla", actions: [{ type: "ADD_TAG", config: {} }] };
    const p = validarBorrador(b);
    expect(p.some((x) => x.campo === "actions" && x.mensaje.startsWith("Acción 1:"))).toBe(true);
    const c = validarBorrador({ ...b, tree: { combinator: "all", items: [{ field: "", op: "eq", value: "" }] } });
    expect(c.some((x) => x.campo === "conditions")).toBe(true);
  });
  it("el disparador con campo exige su valor", () => {
    const b = { ...borradorNuevo(), name: "Regla", triggerKey: "score_threshold", actions: [{ type: "ADD_TAG", config: { tag: "a" } }] };
    expect(validarBorrador(b).some((x) => x.campo === "trigger")).toBe(true);
    expect(validarBorrador({ ...b, triggerValue: "70" }).some((x) => x.campo === "trigger")).toBe(false);
    // Etapa: el campo es opcional (vacío = cualquier cambio de etapa).
    expect(validarBorrador({ ...b, triggerKey: "stage_change" }).some((x) => x.campo === "trigger")).toBe(false);
  });
  it("contexto y avisos del disparador", () => {
    expect(contextoDeDisparador("stage_change")).toBe("deal");
    expect(contextoDeDisparador("no.existe")).toBe("contact");
    expect(avisoDeDisparador("lead.captured")).toBeNull();
    expect(avisoDeDisparador("time")).toBeTruthy();
    expect(avisoDeDisparador("no.existe")).toBeTruthy();
  });
});

describe("workflow-builder-model: tarjetas y recetas", () => {
  it("mover y quitar acciones y seguir la tarjeta abierta", () => {
    expect(moverAccion(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moverAccion(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(quitarAccion(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(indiceAbiertoTrasMover(0, 0, 1)).toBe(1);
    expect(indiceAbiertoTrasMover(1, 0, 1)).toBe(0);
    expect(indiceAbiertoTrasMover(2, 0, 1)).toBe(2);
    expect(indiceAbiertoTrasQuitar(2, 0)).toBe(1);
    expect(indiceAbiertoTrasQuitar(1, 1)).toBeNull();
    expect(indiceAbiertoTrasQuitar(null, 1)).toBeNull();
  });
  it("las recetas se cargan completas y muestran su frase", () => {
    for (const t of RULE_TEMPLATES) {
      const b = borradorDesdePlantilla(t);
      expect(b.name).toBe(t.rule.name);
      expect(b.triggerKey).toBe("lead.captured");
      expect(payloadDeBorrador(b, { activate: false }).actions).toEqual(t.rule.actions);
      expect(fraseDePlantilla(t)).toMatch(/^Cuando entra un lead · si /);
    }
  });
});
