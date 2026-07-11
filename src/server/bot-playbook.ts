"use server";

import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { invalidateBotConfigCache } from "@/lib/bot/config";
import { isCustomTarget, isNativeTarget } from "@/lib/bot/playbook/fields";
import { playbookUpsertSchema, type PlaybookUpsertInput } from "./bot-playbook.schema";

const ADMIN_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];

async function requireAdminRole() {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");
  if (!ADMIN_ROLES.includes(session.user.role)) {
    throw new Error("Acceso denegado: se requiere rol de administración");
  }
  return session;
}

function validateTargetField(field: string): void {
  if (!isNativeTarget(field) && !isCustomTarget(field)) {
    throw new Error(`targetField inválido: "${field}" no es un campo nativo ni custom.*`);
  }
}

export async function listPlaybooks() {
  await requireAdminRole();
  return prisma.botPlaybook.findMany({
    where: { deletedAt: null },
    include: {
      _count: { select: { tasks: true } },
      tasks: { orderBy: { order: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPlaybook(id: string) {
  await requireAdminRole();
  return prisma.botPlaybook.findUnique({
    where: { id },
    include: { tasks: { orderBy: { order: "asc" } } },
  });
}

export async function upsertPlaybook(input: PlaybookUpsertInput) {
  const session = await requireAdminRole();
  const data = playbookUpsertSchema.parse(input);

  const seenKeys = new Set<string>();
  const seenOrders = new Set<number>();
  for (const task of data.tasks) {
    validateTargetField(task.targetField);
    if (seenKeys.has(task.key)) {
      throw new Error(`Tarea duplicada: la key "${task.key}" aparece más de una vez`);
    }
    seenKeys.add(task.key);
    if (seenOrders.has(task.order)) {
      throw new Error(`Tarea duplicada: el order ${task.order} aparece más de una vez`);
    }
    seenOrders.add(task.order);
  }

  const isNew = !data.id;

  const saved = await prisma.$transaction(async (tx) => {
    const playbook = data.id
      ? await tx.botPlaybook.update({
          where: { id: data.id },
          data: { name: data.name, description: data.description ?? null },
        })
      : await tx.botPlaybook.create({
          data: { name: data.name, description: data.description ?? null },
        });

    // Recrear tareas desde cero: más simple y seguro que hacer diff granular
    // (el playbook completo se edita como una unidad desde el admin).
    await tx.botTask.deleteMany({ where: { playbookId: playbook.id } });

    if (data.tasks.length > 0) {
      await tx.botTask.createMany({
        data: data.tasks.map((t) => ({
          playbookId: playbook.id,
          order: t.order,
          key: t.key,
          objective: t.objective,
          targetField: t.targetField,
          captureType: t.captureType,
          enumOptions: t.enumOptions as unknown as Prisma.InputJsonValue,
          extractionHint: t.extractionHint ?? null,
          required: t.required,
          skipIfFilled: t.skipIfFilled,
        })),
      });
    }

    return tx.botPlaybook.findUniqueOrThrow({
      where: { id: playbook.id },
      include: { tasks: { orderBy: { order: "asc" } } },
    });
  });

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: isNew ? "CREATE" : "UPDATE",
      entity: "BotPlaybook",
      entityId: saved.id,
      changes: data as unknown as Prisma.InputJsonValue,
    },
  });

  return saved;
}

// Activa (o desactiva, con id:null) un playbook como el que usa el bot en
// runtime. bot-respond.ts sólo usa un playbook si activePlaybookId coincide
// Y BotPlaybook.isActive === true, así que esta función es la dueña de ese
// invariante: marca isActive:true en el elegido y lo desmarca en cualquier
// otro que lo tuviera (sólo puede haber un playbook activo a la vez).
export async function setActivePlaybook(id: string | null): Promise<void> {
  const session = await requireAdminRole();

  if (id !== null) {
    const playbook = await prisma.botPlaybook.findUnique({ where: { id } });
    if (!playbook || playbook.deletedAt) {
      throw new Error("Playbook no encontrado");
    }
  }

  const configId = await prisma.$transaction(async (tx) => {
    if (id !== null) {
      await tx.botPlaybook.updateMany({
        where: { id: { not: id }, isActive: true },
        data: { isActive: false },
      });
      await tx.botPlaybook.update({ where: { id }, data: { isActive: true } });
    }

    const existing = await tx.botConfig.findFirst({ select: { id: true } });
    const row = existing
      ? await tx.botConfig.update({ where: { id: existing.id }, data: { activePlaybookId: id } })
      : await tx.botConfig.create({ data: { singleton: true, activePlaybookId: id } });
    return row.id;
  });

  invalidateBotConfigCache();

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "BotConfig",
      entityId: configId,
      changes: { activePlaybookId: id },
    },
  });
}

export async function deletePlaybook(id: string): Promise<void> {
  const session = await requireAdminRole();

  const playbook = await prisma.botPlaybook.findUnique({ where: { id } });
  if (!playbook || playbook.deletedAt) {
    throw new Error("Playbook no encontrado");
  }

  let wasActive = false;

  await prisma.$transaction(async (tx) => {
    await tx.botPlaybook.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    const config = await tx.botConfig.findFirst({ select: { id: true, activePlaybookId: true } });
    if (config?.activePlaybookId === id) {
      await tx.botConfig.update({ where: { id: config.id }, data: { activePlaybookId: null } });
      wasActive = true;
    }
  });

  if (wasActive) invalidateBotConfigCache();

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "DELETE",
      entity: "BotPlaybook",
      entityId: id,
      changes: { deletedAt: new Date().toISOString(), wasActive },
    },
  });
}
