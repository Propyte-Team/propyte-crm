import { describe, it, expect } from "vitest";
import { NATIVE_TARGET_FIELDS, isNativeTarget, isCustomTarget } from "./fields";

describe("playbook fields", () => {
  it("incluye los campos nativos clave con captureType", () => {
    for (const f of ["firstName","budgetMax","preferredZone","propertyType","purchaseTimeline"]) {
      expect(NATIVE_TARGET_FIELDS[f]).toBeDefined();
      expect(NATIVE_TARGET_FIELDS[f].captureType.length).toBeGreaterThan(0);
    }
  });
  it("los campos enum traen enumValues exactos", () => {
    expect(NATIVE_TARGET_FIELDS.propertyType.enumValues).toEqual(["DEPARTAMENTO","CASA","TERRENO","MACROLOTE","LOCAL_COMERCIAL","OTRO"]);
    expect(NATIVE_TARGET_FIELDS.purchaseTimeline.enumValues).toEqual(["IMMEDIATE","ONE_TO_THREE_MONTHS","THREE_TO_SIX_MONTHS","SIX_PLUS_MONTHS"]);
  });
  it("distingue nativo vs custom", () => {
    expect(isNativeTarget("budgetMax")).toBe(true);
    expect(isNativeTarget("hackerField")).toBe(false);
    expect(isCustomTarget("custom.foo")).toBe(true);
    expect(isCustomTarget("budgetMax")).toBe(false);
  });
});
