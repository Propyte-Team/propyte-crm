// Guards de consistencia del builder visual de reglas (cluster "workflow-builder
// consistency"). Sin @testing-library/react/jsdom en este repo (no hay .test.tsx
// existentes) — cubrimos el contrato vía los exports puros del módulo, igual que
// el resto del repo prueba lógica de UI a través de módulos puros (builder-model,
// node-catalog) en vez de renderizar componentes.
import { describe, it, expect } from "vitest";
import { NODE_CATALOG, fieldDefsFor, TRIGGER_CATALOG } from "@/lib/journey/node-catalog";
import { workflowActionTypes, TRIGGER_TYPES } from "@/lib/validations/rebuild-f1";
import { BUILDER_ACTION_TYPES, BUILDER_ACTION_FIELDS, BUILDER_TRIGGER_TYPES, shouldGuardRule } from "./workflow-builder";

describe("WorkflowBuilder deriva su catálogo de node-catalog (sub-task 2 — sin mapas duplicados)", () => {
  it("BUILDER_ACTION_TYPES es exactamente el set de acciones del catálogo (sin divergencia)", () => {
    expect([...BUILDER_ACTION_TYPES].sort()).toEqual([...workflowActionTypes].sort());
    expect([...BUILDER_ACTION_TYPES].sort()).toEqual([...NODE_CATALOG.map((m) => m.type)].sort());
  });

  it("BUILDER_ACTION_FIELDS coincide con fieldDefsFor del catálogo para cada tipo (sin divergencia de keys)", () => {
    for (const t of workflowActionTypes) {
      expect(BUILDER_ACTION_FIELDS[t]).toEqual(fieldDefsFor(t));
    }
  });

  it("BUILDER_TRIGGER_TYPES cubre TRIGGER_TYPES compartido (sin lista local duplicada)", () => {
    const values = BUILDER_TRIGGER_TYPES.map((t) => t.value).sort();
    expect(values).toEqual([...TRIGGER_TYPES].sort());
    expect(values).toEqual(TRIGGER_CATALOG.map((m) => m.type).sort());
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
