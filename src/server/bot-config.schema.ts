// Esquema de validacion para actualizar BotConfig. Vive fuera de bot-config.ts
// porque un archivo "use server" solo puede exportar funciones async
// (ver https://nextjs.org/docs/messages/invalid-use-server-value).
import { z } from "zod";

export const ALLOWED_MODELS = ["claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5"] as const;

export const botConfigUpdateSchema = z.object({
  botEnabled: z.boolean().optional(),
  tonePreset: z.enum(["PROFESIONAL_CALIDO", "CALIDO_CERCANO_MX", "EJECUTIVO_SOBRIO", "NEUTRO_DIRECTO"]).optional(),
  autonomyLevel: z.enum(["L0", "L1", "L2"]).optional(),
  model: z.enum(ALLOWED_MODELS).optional(),
  openerStyle: z.enum(["WARM_NAME", "DIRECT"]).optional(),
  maxLines: z.number().int().min(1).max(8).optional(),
  dataGateStrict: z.boolean().optional(),
  escalationTriggers: z.array(z.string().min(1)).max(20).optional(),
  enabledChannels: z.array(z.enum(["WHATSAPP", "INSTAGRAM", "MESSENGER", "SMS"])).optional(),
});

export type BotConfigUpdateInput = z.infer<typeof botConfigUpdateSchema>;
