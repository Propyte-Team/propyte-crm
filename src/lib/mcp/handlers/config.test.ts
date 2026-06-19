// src/lib/mcp/handlers/config.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ default: {
  team: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  territory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  territoryRule: { deleteMany: vi.fn(), createMany: vi.fn() },
  customFieldDef: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  agentDef: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  agentRun: { findMany: vi.fn() },
  relationshipDef: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  $transaction: vi.fn(async (fn: any) => fn({
    territoryRule: { deleteMany: vi.fn(), createMany: vi.fn() },
  })),
}}));
vi.mock("@/lib/metadata/governance", () => ({
  validateApiName: vi.fn(),
  findSimilarFields: vi.fn(() => []),
}));
vi.mock("@/lib/metadata/registry", () => ({
  invalidateMetadataCache: vi.fn(),
  getActiveFields: vi.fn(),
}));
vi.mock("@/lib/agents/tools", () => ({
  AGENT_TOOLS: [
    { name: "capture_lead",   description: "Captura lead" },
    { name: "match_units",    description: "Match unidades" },
    { name: "send_whatsapp",  description: "Enviar WA" },
    { name: "create_task",    description: "Crear tarea" },
    { name: "search_contacts",description: "Buscar contactos" },
  ],
}));

import prisma from "@/lib/db";
import { validateApiName, findSimilarFields } from "@/lib/metadata/governance";
import { invalidateMetadataCache } from "@/lib/metadata/registry";
import {
  listTeamsFull, createTeam, updateTeam,
  listTerritories, createTerritory, setTerritoryRules,
  listCustomFields, createCustomField, updateCustomField,
  listAgents, getAgent, createAgent, updateAgent,
  listRelationships, createRelationship,
} from "./config";

// ─── Teams ───────────────────────────────────────────────────────────────────

describe("teams", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createTeam dedup por nombre", async () => {
    (prisma.team.findFirst as any).mockResolvedValue({ id: "t1" });
    await expect(createTeam({ name: "Equipo Norte", plaza: "PDC" }, "u1"))
      .rejects.toThrow(/ya existe/i);
  });

  it("createTeam crea equipo correctamente", async () => {
    (prisma.team.findFirst as any).mockResolvedValue(null);
    (prisma.team.create as any).mockImplementation(({ data }: any) => ({ id: "t1", ...data }));
    const r: any = await createTeam({ name: "Equipo Norte", plaza: "PDC" }, "u1");
    expect(r.name).toBe("Equipo Norte");
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it("updateTeam 404 si no existe", async () => {
    (prisma.team.findFirst as any).mockResolvedValue(null);
    await expect(updateTeam("missing", { name: "X" }, "u1"))
      .rejects.toThrow(/no encontrado/i);
  });
});

// ─── Territories ─────────────────────────────────────────────────────────────

describe("territories", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createTerritory dedup por nombre", async () => {
    (prisma.territory.findFirst as any).mockResolvedValue({ id: "tr1" });
    await expect(createTerritory({ name: "Zona Centro" }, "u1"))
      .rejects.toThrow(/ya existe/i);
  });

  it("createTerritory crea territorio correctamente", async () => {
    (prisma.territory.findFirst as any).mockResolvedValue(null);
    (prisma.territory.create as any).mockImplementation(({ data }: any) => ({ id: "tr1", ...data }));
    const r: any = await createTerritory({ name: "Zona Norte", type: "GEO" }, "u1");
    expect(r.name).toBe("Zona Norte");
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it("setTerritoryRules reemplaza reglas y llama writeAudit", async () => {
    (prisma.territory.findFirst as any).mockResolvedValue({ id: "tr1", name: "Zona Norte" });
    const txMock = { territoryRule: { deleteMany: vi.fn(), createMany: vi.fn() } };
    (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(txMock));

    await setTerritoryRules({
      territoryId: "tr1",
      rules: [{ conditions: { field: "plaza", op: "eq", value: "PDC" }, priority: 10, isActive: true }],
    }, "u1");

    expect(txMock.territoryRule.deleteMany).toHaveBeenCalled();
    expect(txMock.territoryRule.createMany).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});

// ─── Custom Fields ────────────────────────────────────────────────────────────

describe("customFields", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createCustomField rechaza apiName inválido", async () => {
    (validateApiName as any).mockReturnValue({ ok: false, reason: "Debe iniciar con contact_" });
    await expect(createCustomField({
      objectApiName: "contact", apiName: "bad_name", label: "Test", fieldType: "TEXT",
    }, "u1")).rejects.toThrow(/Debe iniciar/);
  });

  it("createCustomField bloquea similar sin force", async () => {
    (validateApiName as any).mockReturnValue({ ok: true });
    (prisma.customFieldDef.findMany as any).mockResolvedValue([
      { apiName: "contact_zona_preferida", label: "Zona Preferida" },
    ]);
    (findSimilarFields as any).mockReturnValue([
      { apiName: "contact_zona_preferida", label: "Zona Preferida" },
    ]);
    await expect(createCustomField({
      objectApiName: "contact", apiName: "contact_zona", label: "Zona", fieldType: "TEXT",
    }, "u1")).rejects.toThrow(/similar/i);
  });

  it("createCustomField pasa con force:true aunque similar", async () => {
    (validateApiName as any).mockReturnValue({ ok: true });
    (prisma.customFieldDef.findMany as any).mockResolvedValue([
      { apiName: "contact_zona_preferida", label: "Zona Preferida" },
    ]);
    (findSimilarFields as any).mockReturnValue([
      { apiName: "contact_zona_preferida", label: "Zona Preferida" },
    ]);
    (prisma.customFieldDef.create as any).mockImplementation(({ data }: any) => ({ id: "f1", ...data }));
    const r: any = await createCustomField({
      objectApiName: "contact", apiName: "contact_zona", label: "Zona", fieldType: "TEXT", force: true,
    }, "u1");
    expect(r.id).toBe("f1");
    expect(invalidateMetadataCache).toHaveBeenCalledWith("contact");
  });

  it("updateCustomField archive setea archivedAt e isActive=false", async () => {
    (prisma.customFieldDef.findFirst as any).mockResolvedValue({ id: "f1", objectApiName: "contact" });
    (prisma.customFieldDef.update as any).mockImplementation(({ data }: any) => ({ id: "f1", ...data }));
    const r: any = await updateCustomField("f1", { archive: true }, "u1");
    expect(r.isActive).toBe(false);
    expect(r.archivedAt).toBeDefined();
    expect(invalidateMetadataCache).toHaveBeenCalled();
  });
});

// ─── Agents ───────────────────────────────────────────────────────────────────

describe("agents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createAgent rechaza tool inexistente", async () => {
    (prisma.agentDef.findFirst as any).mockResolvedValue(null);
    await expect(createAgent({
      name: "Bot Meta", goal: "Capturar leads", systemUserId: "u1",
      allowedTools: ["capture_lead", "herramienta_inexistente"],
    }, "u1")).rejects.toThrow(/herramienta_inexistente/);
  });

  it("createAgent nace isActive=false", async () => {
    (prisma.agentDef.findFirst as any).mockResolvedValue(null);
    (prisma.agentDef.create as any).mockImplementation(({ data }: any) => ({ id: "a1", ...data }));
    const r: any = await createAgent({
      name: "Bot Meta", goal: "Capturar leads", systemUserId: "u1",
      allowedTools: ["capture_lead"],
    }, "u1");
    expect(r.isActive).toBe(false);
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it("getAgent 404 si no existe", async () => {
    (prisma.agentDef.findFirst as any).mockResolvedValue(null);
    await expect(getAgent("missing")).rejects.toThrow(/no encontrado/i);
  });
});

// ─── Relationships ────────────────────────────────────────────────────────────

describe("relationships", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createRelationship valida snake_case", async () => {
    await expect(createRelationship({
      name: "Invalid-Name", fromObject: "contact", toObject: "deal",
      kind: "LOOKUP", relatedListLabel: "Deals",
    }, "u1")).rejects.toThrow(/snake_case/i);
  });

  it("createRelationship dedup por nombre", async () => {
    (prisma.relationshipDef.findFirst as any).mockResolvedValue({ id: "r1" });
    await expect(createRelationship({
      name: "contact_deals", fromObject: "contact", toObject: "deal",
      kind: "LOOKUP", relatedListLabel: "Deals",
    }, "u1")).rejects.toThrow(/ya existe/i);
  });

  it("createRelationship crea correctamente", async () => {
    (prisma.relationshipDef.findFirst as any).mockResolvedValue(null);
    (prisma.relationshipDef.create as any).mockImplementation(({ data }: any) => ({ id: "r1", ...data }));
    const r: any = await createRelationship({
      name: "contact_deals", fromObject: "contact", toObject: "deal",
      kind: "LOOKUP", relatedListLabel: "Deals",
    }, "u1");
    expect(r.name).toBe("contact_deals");
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});
