"use server";

// CRUD de agentes del bot por segmento (Frente 4). Mismo patrón RBAC/auditoría
// que bot-playbook.ts. La selección en runtime vive en src/lib/bot/agent-profiles.ts.
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { agentProfileUpsertSchema, type AgentProfileUpsertInput } from "./bot-agents.schema";

const ADMIN_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];

async function requireAdminRole() {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");
  if (!ADMIN_ROLES.includes(session.user.role)) {
    throw new Error("Acceso denegado: se requiere rol de administración");
  }
  return session;
}

export async function listAgentProfiles() {
  await requireAdminRole();
  return prisma.botAgentProfile.findMany({
    where: { deletedAt: null },
    orderBy: { priority: "asc" },
    include: { playbook: { select: { id: true, name: true, deletedAt: true } } },
  });
}

export async function upsertAgentProfile(input: AgentProfileUpsertInput) {
  const session = await requireAdminRole();
  const data = agentProfileUpsertSchema.parse(input);

  if (data.playbookId) {
    const pb = await prisma.botPlaybook.findFirst({ where: { id: data.playbookId, deletedAt: null } });
    if (!pb) throw new Error("El playbook seleccionado no existe");
  }

  const { id, ...fields } = data;
  const payload = { ...fields, playbookId: fields.playbookId ?? null, tonePreset: fields.tonePreset ?? null };

  const profile = id
    ? await prisma.botAgentProfile.update({ where: { id }, data: payload })
    : await prisma.botAgentProfile.create({ data: payload });

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: id ? "UPDATE" : "CREATE",
      entity: "BotAgentProfile",
      entityId: profile.id,
      changes: { name: data.name, contactTypes: data.contactTypes, isActive: data.isActive ?? false, playbookId: data.playbookId ?? null },
    },
  });
  return profile;
}

export async function deleteAgentProfile(id: string) {
  const session = await requireAdminRole();
  const profile = await prisma.botAgentProfile.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "DELETE",
      entity: "BotAgentProfile",
      entityId: id,
      changes: { name: profile.name },
    },
  });
  return { ok: true };
}
