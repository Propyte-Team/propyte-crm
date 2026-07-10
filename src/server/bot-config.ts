"use server";

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { z } from "zod";
import { invalidateBotConfigCache, resolveBotConfig, type BotConfigResolved } from "@/lib/bot/config";

const ADMIN_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];

async function requireAdminRole() {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");
  if (!ADMIN_ROLES.includes(session.user.role)) {
    throw new Error("Acceso denegado: se requiere rol de administración");
  }
  return session;
}

const ALLOWED_MODELS = ["claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5"] as const;

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

export async function getBotConfigForAdmin(): Promise<BotConfigResolved> {
  await requireAdminRole();
  const row = (await prisma.botConfig.findFirst()) as Record<string, unknown> | null;
  return resolveBotConfig(row);
}

export async function updateBotConfig(input: BotConfigUpdateInput): Promise<BotConfigResolved> {
  const session = await requireAdminRole();
  const data = botConfigUpdateSchema.parse(input);

  const existing = await prisma.botConfig.findFirst({ select: { id: true } });
  const row = existing
    ? await prisma.botConfig.update({
        where: { id: existing.id },
        data: { ...data, updatedByUserId: session.user.id },
      })
    : await prisma.botConfig.create({
        data: { ...data, singleton: true, updatedByUserId: session.user.id },
      });

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "BotConfig",
      entityId: row.id,
      changes: data,
    },
  });

  invalidateBotConfigCache();
  return resolveBotConfig(row as unknown as Record<string, unknown>);
}
