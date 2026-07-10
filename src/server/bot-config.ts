"use server";

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { invalidateBotConfigCache, resolveBotConfig, type BotConfigResolved } from "@/lib/bot/config";
import { botConfigUpdateSchema, type BotConfigUpdateInput } from "./bot-config.schema";

const ADMIN_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];

async function requireAdminRole() {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");
  if (!ADMIN_ROLES.includes(session.user.role)) {
    throw new Error("Acceso denegado: se requiere rol de administración");
  }
  return session;
}

export async function getBotConfigForAdmin(): Promise<BotConfigResolved> {
  await requireAdminRole();
  let row: Record<string, unknown> | null = null;
  try {
    row = (await prisma.botConfig.findFirst()) as Record<string, unknown> | null;
  } catch {
    row = null; // tabla aún no migrada → defaults seguros
  }
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
