// Zod del CRUD de agentes del bot — archivo aparte porque un "use server"
// solo puede exportar funciones async (misma razón que bot-config.schema.ts).
import { z } from "zod";

export const AGENT_CONTACT_TYPES = [
  "LEAD", "PROSPECTO", "CLIENTE", "INVERSIONISTA", "BROKER_EXTERNO",
  "REFERIDO", "EMPLEO", "COMPRADOR", "REFERIDOR",
] as const;

export const AGENT_TONE_PRESETS = [
  "PROFESIONAL_CALIDO", "CALIDO_CERCANO_MX", "EJECUTIVO_SOBRIO", "NEUTRO_DIRECTO",
] as const;

export const agentProfileUpsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(80).trim(),
  contactTypes: z.array(z.enum(AGENT_CONTACT_TYPES)).min(1),
  identity: z.string().min(1).max(2000).trim(),
  playbookId: z.string().nullable().optional(),
  tonePreset: z.enum(AGENT_TONE_PRESETS).nullable().optional(),
  isActive: z.boolean().optional().default(false),
  priority: z.number().int().min(1).max(999).optional().default(100),
});

export type AgentProfileUpsertInput = z.input<typeof agentProfileUpsertSchema>;
