// src/lib/mcp/handlers/config.ts
import { z } from "zod";
import prisma from "@/lib/db";
import { validateApiName, findSimilarFields } from "@/lib/metadata/governance";
import { invalidateMetadataCache, getActiveFields } from "@/lib/metadata/registry";
import { AGENT_TOOLS } from "@/lib/agents/tools";
import { writeAudit } from "../respond";

// =====================================================================
// TEAMS
// =====================================================================

const PLAZAS = ["PDC", "TULUM", "MERIDA"] as const;

const createTeamSchema = z.object({
  name:              z.string().min(2).max(120).trim(),
  plaza:             z.enum(PLAZAS),
  leaderId:          z.string().optional(),
  parentTeamId:      z.string().optional(),
  forecastManagerId: z.string().optional(),
});

const updateTeamSchema = z.object({
  name:              z.string().min(2).max(120).trim().optional(),
  leaderId:          z.string().nullable().optional(),
  forecastManagerId: z.string().nullable().optional(),
  isActive:          z.boolean().optional(),
});

export async function listTeamsFull() {
  return prisma.team.findMany({
    where: { deletedAt: null },
    include: {
      leader: { select: { id: true, name: true } },
      members: {
        where: { leftAt: null },
        include: { user: { select: { id: true, name: true } } },
      },
      parentTeam: { select: { id: true, name: true } },
    },
  });
}

export async function createTeam(body: unknown, userId: string) {
  const d = createTeamSchema.parse(body);
  if (await prisma.team.findFirst({ where: { name: d.name, deletedAt: null } }))
    throw new Error("Ya existe un equipo con ese nombre");
  const team = await prisma.team.create({
    data: {
      name:              d.name,
      plaza:             d.plaza,
      leaderId:          d.leaderId ?? null,
      parentTeamId:      d.parentTeamId ?? null,
      forecastManagerId: d.forecastManagerId ?? null,
    },
  });
  await writeAudit(userId, "CREATE", "Team", team.id, { name: d.name });
  return team;
}

export async function updateTeam(id: string, body: unknown, userId: string) {
  const existing = await prisma.team.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new Error("Equipo no encontrado");
  const d = updateTeamSchema.parse(body);
  const data: Record<string, unknown> = {};
  if (d.name              !== undefined) data.name              = d.name;
  if (d.leaderId          !== undefined) data.leaderId          = d.leaderId;
  if (d.forecastManagerId !== undefined) data.forecastManagerId = d.forecastManagerId;
  if (d.isActive          !== undefined) data.isActive          = d.isActive;
  const team = await prisma.team.update({ where: { id }, data: data as never });
  await writeAudit(userId, "UPDATE", "Team", id, { changed: Object.keys(d) });
  return team;
}

// =====================================================================
// TERRITORIES
// =====================================================================

const TERRITORY_TYPES = ["GEO", "SEGMENT"] as const;

const createTerritorySchema = z.object({
  name:               z.string().min(2).max(120).trim(),
  type:               z.enum(TERRITORY_TYPES).default("GEO"),
  plaza:              z.enum(PLAZAS).optional(),
  zones:              z.array(z.string()).default([]),
  parentTerritoryId:  z.string().optional(),
  forecastManagerId:  z.string().optional(),
});

const setTerritoryRulesSchema = z.object({
  territoryId: z.string(),
  rules: z.array(z.object({
    priority:   z.number().int().default(100),
    conditions: z.record(z.unknown()),
    isActive:   z.boolean().default(true),
  })),
});

export async function listTerritories() {
  return prisma.territory.findMany({
    where: { deletedAt: null },
    include: {
      rules: true,
      parentTerritory: { select: { id: true, name: true } },
    },
  });
}

export async function createTerritory(body: unknown, userId: string) {
  const d = createTerritorySchema.parse(body);
  if (await prisma.territory.findFirst({ where: { name: d.name, deletedAt: null } }))
    throw new Error("Ya existe un territorio con ese nombre");
  const territory = await prisma.territory.create({
    data: {
      name:              d.name,
      type:              d.type,
      plaza:             d.plaza ?? null,
      zones:             d.zones,
      parentTerritoryId: d.parentTerritoryId ?? null,
      forecastManagerId: d.forecastManagerId ?? null,
    },
  });
  await writeAudit(userId, "CREATE", "Territory", territory.id, { name: d.name });
  return territory;
}

export async function setTerritoryRules(body: unknown, userId: string) {
  const d = setTerritoryRulesSchema.parse(body);
  const territory = await prisma.territory.findFirst({ where: { id: d.territoryId, deletedAt: null } });
  if (!territory) throw new Error("Territorio no encontrado");

  await prisma.$transaction(async (tx) => {
    await tx.territoryRule.deleteMany({ where: { territoryId: d.territoryId } });
    await tx.territoryRule.createMany({
      data: d.rules.map((r) => ({
        territoryId: d.territoryId,
        priority:    r.priority,
        conditions:  r.conditions as never,
        isActive:    r.isActive,
      })),
    });
  });

  await writeAudit(userId, "UPDATE", "Territory", d.territoryId, { rules: d.rules.length });
}

// =====================================================================
// CUSTOM FIELDS (gobernanza)
// =====================================================================

const FIELD_TYPES = [
  "TEXT","TEXTAREA","NUMBER","CURRENCY","PERCENT","DATE","DATETIME","BOOLEAN",
  "EMAIL","PHONE","URL","PICKLIST","MULTI_PICKLIST","AUTO_NUMBER","FORMULA",
  "FILE","USER","LOOKUP","MASTER_DETAIL","ROLLUP","GEO",
] as const;

const createFieldSchema = z.object({
  objectApiName: z.string().min(1),
  apiName:       z.string().min(1),
  label:         z.string().min(1).max(120),
  fieldType:     z.enum(FIELD_TYPES),
  isRequired:    z.boolean().default(false),
  isSearchable:  z.boolean().default(false),
  helpText:      z.string().optional(),
  validation:    z.record(z.unknown()).default({}),
  force:         z.boolean().default(false),
});

const updateFieldSchema = z.object({
  label:        z.string().min(1).max(120).optional(),
  helpText:     z.string().nullable().optional(),
  isRequired:   z.boolean().optional(),
  isSearchable: z.boolean().optional(),
  validation:   z.record(z.unknown()).optional(),
  order:        z.number().int().optional(),
  archive:      z.boolean().optional(),
});

export async function listCustomFields(objectApiName?: string) {
  if (objectApiName) return getActiveFields(objectApiName);
  return prisma.customFieldDef.findMany({ where: { archivedAt: null } });
}

export async function createCustomField(body: unknown, userId: string) {
  const d = createFieldSchema.parse(body);

  // 1. Validar apiName por gobernanza
  const check = validateApiName(d.objectApiName, d.apiName);
  if (!check.ok) throw new Error(check.reason ?? "apiName inválido");

  // 2. Detectar duplicados semánticos
  if (!d.force) {
    const existing = await prisma.customFieldDef.findMany({
      where: { objectApiName: d.objectApiName, archivedAt: null },
      select: { apiName: true, label: true },
    });
    const similar = findSimilarFields(d.apiName, d.label, existing);
    if (similar.length > 0) {
      const list = similar.map((s) => `${s.apiName} ("${s.label}")`).join(", ");
      throw new Error(`Campo similar existe: ${list}. Reenvía con force:true para crear igual.`);
    }
  }

  const field = await prisma.customFieldDef.create({
    data: {
      objectApiName: d.objectApiName,
      apiName:       d.apiName,
      label:         d.label,
      fieldType:     d.fieldType,
      isRequired:    d.isRequired,
      isSearchable:  d.isSearchable,
      helpText:      d.helpText ?? null,
      validation:    d.validation as never,
    },
  });

  invalidateMetadataCache(d.objectApiName);
  await writeAudit(userId, "CREATE", "CustomFieldDef", field.id, { apiName: d.apiName, label: d.label });
  return field;
}

export async function updateCustomField(id: string, body: unknown, userId: string) {
  const existing = await prisma.customFieldDef.findFirst({ where: { id, archivedAt: null } });
  if (!existing) throw new Error("Campo no encontrado o ya archivado");

  const d = updateFieldSchema.parse(body);
  const data: Record<string, unknown> = {};

  if (d.label       !== undefined) data.label       = d.label;
  if (d.helpText    !== undefined) data.helpText     = d.helpText;
  if (d.isRequired  !== undefined) data.isRequired   = d.isRequired;
  if (d.isSearchable !== undefined) data.isSearchable = d.isSearchable;
  if (d.validation  !== undefined) data.validation   = d.validation;
  if (d.order       !== undefined) data.order        = d.order;

  // Archive: soft-delete manteniendo los valores
  if (d.archive) {
    data.archivedAt = new Date();
    data.isActive   = false;
  }

  const field = await prisma.customFieldDef.update({ where: { id }, data: data as never });
  invalidateMetadataCache(existing.objectApiName);
  await writeAudit(userId, "UPDATE", "CustomFieldDef", id, { changed: Object.keys(d) });
  return field;
}

// =====================================================================
// AGENTS
// =====================================================================

const AUTONOMY_LEVELS = ["L0", "L1", "L2"] as const;

const createAgentSchema = z.object({
  name:          z.string().min(2).max(120).trim(),
  goal:          z.string().min(1),
  systemUserId:  z.string(),
  autonomyLevel: z.enum(AUTONOMY_LEVELS).default("L2"),
  allowedTools:  z.array(z.string()).min(1),
  trigger:       z.record(z.unknown()).default({}),
  limits:        z.record(z.unknown()).default({}),
  isActive:      z.boolean().default(false),
});

const updateAgentSchema = z.object({
  isActive:      z.boolean().optional(),
  autonomyLevel: z.enum(AUTONOMY_LEVELS).optional(),
  goal:          z.string().min(1).optional(),
  allowedTools:  z.array(z.string()).optional(),
});

const KNOWN_TOOL_NAMES = new Set(AGENT_TOOLS.map((t) => t.name));

function validateTools(tools: string[]) {
  const unknown = tools.filter((t) => !KNOWN_TOOL_NAMES.has(t));
  if (unknown.length > 0)
    throw new Error(`Herramientas desconocidas: ${unknown.join(", ")}`);
}

export async function listAgents() {
  const agents = await prisma.agentDef.findMany({ where: { deletedAt: null } });
  const availableTools = AGENT_TOOLS.map((t) => ({ name: t.name, description: t.description }));
  return { agents, availableTools };
}

export async function getAgent(id: string) {
  const agent = await prisma.agentDef.findFirst({ where: { id, deletedAt: null } });
  if (!agent) throw new Error("Agente no encontrado");
  // agentRun existe en schema, incluir últimas 10 corridas
  const runs = await prisma.agentRun.findMany({
    where: { agentId: id },
    orderBy: { startedAt: "desc" },
    take: 10,
  });
  return { ...agent, runs };
}

export async function createAgent(body: unknown, userId: string) {
  const d = createAgentSchema.parse(body);
  validateTools(d.allowedTools);

  if (await prisma.agentDef.findFirst({ where: { name: d.name, deletedAt: null } }))
    throw new Error("Ya existe un agente con ese nombre");

  const agent = await prisma.agentDef.create({
    data: {
      name:          d.name,
      goal:          d.goal,
      systemUserId:  d.systemUserId,
      autonomyLevel: d.autonomyLevel,
      allowedTools:  d.allowedTools,
      trigger:       d.trigger as never,
      limits:        d.limits as never,
      isActive:      false, // siempre nace inactivo
    },
  });

  await writeAudit(userId, "CREATE", "AgentDef", agent.id, { name: d.name });
  return agent;
}

export async function updateAgent(id: string, body: unknown, userId: string) {
  const existing = await prisma.agentDef.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new Error("Agente no encontrado");

  const d = updateAgentSchema.parse(body);
  if (d.allowedTools !== undefined) validateTools(d.allowedTools);

  const data: Record<string, unknown> = {};
  if (d.isActive      !== undefined) data.isActive      = d.isActive;
  if (d.autonomyLevel !== undefined) data.autonomyLevel = d.autonomyLevel;
  if (d.goal          !== undefined) data.goal          = d.goal;
  if (d.allowedTools  !== undefined) data.allowedTools  = d.allowedTools;

  const agent = await prisma.agentDef.update({ where: { id }, data: data as never });
  await writeAudit(userId, "UPDATE", "AgentDef", id, { changed: Object.keys(d) });
  return agent;
}

// =====================================================================
// RELATIONSHIPS
// =====================================================================

const RELATIONSHIP_KINDS   = ["LOOKUP", "MASTER_DETAIL", "MANY_TO_MANY"] as const;
const ON_DELETE_BEHAVIORS  = ["SET_NULL", "CASCADE", "RESTRICT"] as const;

const createRelationshipSchema = z.object({
  name:             z.string().regex(/^[a-z][a-z0-9_]*$/, "name debe ser snake_case (^[a-z][a-z0-9_]*$)"),
  fromObject:       z.string().min(1),
  toObject:         z.string().min(1),
  kind:             z.enum(RELATIONSHIP_KINDS),
  onDelete:         z.enum(ON_DELETE_BEHAVIORS).default("SET_NULL"),
  relatedListLabel: z.string().min(1).max(120),
  allowMultiple:    z.boolean().default(false),
  isRequired:       z.boolean().default(false),
});

export async function listRelationships() {
  return prisma.relationshipDef.findMany({ where: { isActive: true } });
}

export async function createRelationship(body: unknown, userId: string) {
  const d = createRelationshipSchema.parse(body);

  if (await prisma.relationshipDef.findFirst({ where: { name: d.name } }))
    throw new Error("Ya existe una relación con ese nombre");

  const rel = await prisma.relationshipDef.create({
    data: {
      name:             d.name,
      fromObject:       d.fromObject,
      toObject:         d.toObject,
      kind:             d.kind,
      onDelete:         d.onDelete,
      relatedListLabel: d.relatedListLabel,
      allowMultiple:    d.allowMultiple,
      isRequired:       d.isRequired,
    },
  });

  await writeAudit(userId, "CREATE", "RelationshipDef", rel.id, { name: d.name });
  return rel;
}
