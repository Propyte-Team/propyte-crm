import { describe, it, expect } from "vitest";
import { nextTask, buildObjective, isFieldFilled, COMPLETION_OBJECTIVE } from "./engine";

const T = (o: number, key: string, targetField: string, skipIfFilled = true) =>
  ({ key, order: o, objective: `obj ${key}`, targetField, required: true, skipIfFilled });

describe("nextTask", () => {
  it("devuelve la primera por order no completada", () => {
    const tasks = [T(2, "b", "budgetMax"), T(1, "a", "firstName")];
    expect(nextTask(tasks, [], {})?.key).toBe("a");
  });
  it("salta las completadas", () => {
    const tasks = [T(1, "a", "firstName"), T(2, "b", "budgetMax")];
    expect(nextTask(tasks, ["a"], {})?.key).toBe("b");
  });
  it("salta las ya llenas cuando skipIfFilled", () => {
    const tasks = [T(1, "a", "preferredZone"), T(2, "b", "budgetMax")];
    expect(nextTask(tasks, [], { preferredZone: "Tulum" })?.key).toBe("b");
  });
  it("NO salta las llenas si skipIfFilled=false", () => {
    const tasks = [T(1, "a", "preferredZone", false)];
    expect(nextTask(tasks, [], { preferredZone: "Tulum" })?.key).toBe("a");
  });
  it("todas resueltas → null", () => {
    const tasks = [T(1, "a", "firstName")];
    expect(nextTask(tasks, ["a"], {})).toBeNull();
  });
});

describe("isFieldFilled", () => {
  it("nativo lleno/vacío", () => {
    expect(isFieldFilled({ budgetMax: 3 }, "budgetMax")).toBe(true);
    expect(isFieldFilled({ budgetMax: null }, "budgetMax")).toBe(false);
    expect(isFieldFilled({}, "firstName")).toBe(false);
  });
  it("custom", () => {
    expect(isFieldFilled({ custom: { foo: "x" } }, "custom.foo")).toBe(true);
    expect(isFieldFilled({ custom: {} }, "custom.foo")).toBe(false);
  });
});

describe("buildObjective / COMPLETION_OBJECTIVE", () => {
  it("incluye el objective de la tarea", () => {
    expect(buildObjective(T(1, "a", "firstName"))).toContain("obj a");
  });
  it("completion no vacío", () => { expect(COMPLETION_OBJECTIVE.length).toBeGreaterThan(0); });
});
