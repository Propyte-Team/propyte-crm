// Validación de RoutingRule para la API admin (Configuración → Equipos & Territorios).
// Separada del handler MCP (lib/mcp/handlers/automation.ts) porque aquí `targets` sí se
// valida campo por campo: el motor (`autoRouteLead`) lee `roles`, `userIds` y `plaza`, y
// un objeto libre dejaba pasar claves que el reparto ignora en silencio.
import { z } from "zod";
import { conditionsDslSchema } from "./rebuild-f1";

export const ROUTING_STRATEGIES = ["ROUND_ROBIN", "PERFORMANCE", "GUARDIA", "MANUAL"] as const;
export const ROUTING_PLAZAS = ["PDC", "TULUM", "MERIDA"] as const;
// Roles que una regla puede nombrar como destino. Sin roles, el motor usa ROLES_RUTEABLES.
export const ROUTING_TARGET_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "TEAM_LEADER", "GERENTE"] as const;

export const routingTargetsSchema = z
  .object({
    roles: z.array(z.enum(ROUTING_TARGET_ROLES)).optional(),
    userIds: z.array(z.string().guid()).optional(),
    plaza: z.enum(ROUTING_PLAZAS).optional(),
  })
  .strict();

export const routingRuleCreateSchema = z.object({
  name: z.string().trim().min(3).max(120),
  priority: z.number().int().min(1).max(1000).default(100),
  // Nace activa: la crea una persona desde la pantalla y la ve en la lista (el MCP la crea inactiva).
  isActive: z.boolean().default(true),
  conditions: conditionsDslSchema.default({}),
  strategy: z.enum(ROUTING_STRATEGIES),
  targets: routingTargetsSchema.default({}),
});

export const routingRulePatchSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  priority: z.number().int().min(1).max(1000).optional(),
  isActive: z.boolean().optional(),
  conditions: conditionsDslSchema.optional(),
  strategy: z.enum(ROUTING_STRATEGIES).optional(),
  targets: routingTargetsSchema.optional(),
});

export type RoutingTargets = z.infer<typeof routingTargetsSchema>;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];
