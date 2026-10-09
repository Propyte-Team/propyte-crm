// Validación del CRUD de marcas del agente (2026-10-09, spec marcas-agente).
// Los enums (Plaza, BotTonePreset) se repiten a mano contra prisma/schema.prisma porque este
// módulo no importa @prisma/client; la prueba de brand.test.ts fija los valores.
// `.strict()`: `isDefault` NUNCA viene del cliente (la fila predeterminada la siembra la
// migración y no se puede crear otra), así que una clave desconocida se rechaza en vez de ignorarse.
import { z } from "zod";

export const BRAND_CHANNELS = ["WHATSAPP", "INSTAGRAM", "MESSENGER"] as const;

const base = {
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/, "Solo minúsculas, números y guiones (2-40)"),
  persona: z.string().max(2000).nullable().optional(),
  knowledge: z.string().max(20000).nullable().optional(),
  developmentIds: z.array(z.string().uuid()).max(20).optional(),
  defaultPlaza: z.enum(["PDC", "TULUM", "MERIDA"]).nullable().optional(),
  // null = hereda los canales de la configuración global del bot.
  enabledChannels: z.array(z.enum(BRAND_CHANNELS)).nullable().optional(),
  tonePreset: z
    .enum(["PROFESIONAL_CALIDO", "CALIDO_CERCANO_MX", "EJECUTIVO_SOBRIO", "NEUTRO_DIRECTO"])
    .nullable()
    .optional(),
  playbookId: z.string().uuid().nullable().optional(),
  marketingOwnerUserId: z.string().uuid().nullable().optional(),
  botEnabled: z.boolean().optional(),
};

// Al crear, el agente de la marca nace apagado. En el PATCH NO se declara el default: un cuerpo
// sin `botEnabled` no debe apagar el agente de una marca que ya estaba encendida.
export const brandCreateSchema = z
  .object({ ...base, botEnabled: z.boolean().default(false) })
  .strict();
export const brandPatchSchema = z.object(base).partial().strict();
export type BrandCreateInput = z.infer<typeof brandCreateSchema>;
export type BrandPatchInput = z.infer<typeof brandPatchSchema>;
