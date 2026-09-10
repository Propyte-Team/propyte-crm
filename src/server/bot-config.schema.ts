// Esquema de validacion para actualizar BotConfig. Vive fuera de bot-config.ts
// porque un archivo "use server" solo puede exportar funciones async
// (ver https://nextjs.org/docs/messages/invalid-use-server-value).
import { z } from "zod";

// La lista se mudó a lib/bot/model.ts: la necesitan también lib/bot/claude.ts y
// lib/agents/runner.ts, que leían BOT_MODEL en crudo y por tanto se saltaban este
// allowlist. Se re-exporta para no romper a quien la importe de aquí.
export { ALLOWED_MODELS } from "@/lib/bot/model";
import { ALLOWED_MODELS } from "@/lib/bot/model";

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
