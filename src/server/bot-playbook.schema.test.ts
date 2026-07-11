import { describe, it, expect } from "vitest";
import { playbookUpsertSchema, taskInputSchema } from "./bot-playbook.schema";

describe("playbook schema", () => {
  it("acepta un playbook válido", () => {
    expect(
      playbookUpsertSchema.safeParse({
        name: "P",
        tasks: [{ key: "nombre", order: 0, objective: "pide nombre", targetField: "firstName", captureType: "FULL_NAME" }],
      }).success,
    ).toBe(true);
  });

  it("rechaza captureType inválido", () => {
    expect(
      taskInputSchema.safeParse({ key: "a", order: 0, objective: "x", targetField: "firstName", captureType: "NOPE" }).success,
    ).toBe(false);
  });

  it("rechaza key con mayúsculas/espacios", () => {
    expect(
      taskInputSchema.safeParse({ key: "Mi Key", order: 0, objective: "x", targetField: "firstName", captureType: "TEXT" }).success,
    ).toBe(false);
  });
});
