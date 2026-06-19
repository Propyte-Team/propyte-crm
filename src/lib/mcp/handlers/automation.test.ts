// src/lib/mcp/handlers/automation.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ default: {
  automationRule: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  actionPlan: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  actionPlanStep: { deleteMany: vi.fn(), createMany: vi.fn() },
  routingRule: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  slaPolicy: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  actionQueue: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  $transaction: vi.fn(),
} }));
import prisma from "@/lib/db";
import { createRule } from "./automation";

describe("createRule", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rechaza actions vacío", async () => {
    await expect(createRule({ name: "Flujo X", triggerType: "EVENT", actions: [] }, "u1"))
      .rejects.toThrow();
  });
  it("rechaza nombre duplicado", async () => {
    (prisma.automationRule.findFirst as any).mockResolvedValue({ id: "dup" });
    await expect(createRule(
      { name: "Flujo X", triggerType: "EVENT", conditions: {}, actions: [{ type: "ASSIGN", config: {} }] }, "u1"
    )).rejects.toThrow(/ya existe/i);
  });
  it("crea regla inactiva por defecto", async () => {
    (prisma.automationRule.findFirst as any).mockResolvedValue(null);
    (prisma.automationRule.create as any).mockImplementation(({ data }: any) => ({ id: "r1", ...data }));
    const r: any = await createRule(
      { name: "Flujo X", triggerType: "EVENT", conditions: {}, actions: [{ type: "ASSIGN", config: {} }] }, "u1"
    );
    expect(r.isActive).toBe(false);
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});

import { createRouting, createSla } from "./automation";

describe("createRouting", () => {
  beforeEach(() => vi.clearAllMocks());
  it("routing rechaza duplicado", async () => {
    (prisma.routingRule.findFirst as any).mockResolvedValue({ id: "x" });
    await expect(createRouting({ name: "Ruteo TULUM", strategy: "ROUND_ROBIN" }, "u1")).rejects.toThrow(/ya existe/i);
  });
});
