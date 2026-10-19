// Zod del CRUD de agentes del bot — archivo aparte porque un "use server"
// solo puede exportar funciones async (misma razón que bot-config.schema.ts).
import { z } from "zod";
import { CONTACT_TYPE_ORDER } from "@/lib/constants";

// #907: los tipos que un agente puede atender son los vigentes. REFERIDOR salió (lo atiende el
// Agente Brokers); un perfil viejo que aún lo tenga no se puede volver a guardar con él.
export const AGENT_CONTACT_TYPES = CONTACT_TYPE_ORDER;

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
