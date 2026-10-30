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

/**
 * #956: devuelve el resultado en vez de lanzar. En producción Next oculta el mensaje de un error
 * lanzado desde un server action («An error occurred in the Server Components render…» y un
 * 500), así que la persona no sabía qué corregir. Con `{ ok: false, error }` el mensaje llega tal
 * cual a la pestaña.
 */
export type ResultadoGuardarAgente =
  | { ok: true; profile: { id: string } }
  | { ok: false; error: string };

export async function upsertAgentProfile(input: AgentProfileUpsertInput): Promise<ResultadoGuardarAgente> {
  try {
    return { ok: true, profile: await guardarAgente(input) };
  } catch (err) {
    if (err instanceof ErrorDeAgente) return { ok: false, error: err.message };
    console.error("[bot-agents] no se pudo guardar el agente:", err);
    return { ok: false, error: "No se pudo guardar el agente. Intenta de nuevo; si sigue fallando, avisa a sistemas." };
  }
}

/** Error que se le puede mostrar tal cual a quien edita (validación, permisos, playbook). */
class ErrorDeAgente extends Error {}

async function guardarAgente(input: AgentProfileUpsertInput) {
  let session;
  try {
    session = await requireAdminRole();
  } catch (err) {
    throw new ErrorDeAgente(err instanceof Error ? err.message : "No autorizado");
  }
  const parsed = agentProfileUpsertSchema.safeParse(input);
  if (!parsed.success) {
    throw new ErrorDeAgente(parsed.error.issues.map((i) => i.message).join(". "));
  }
  const data = parsed.data;

  if (data.playbookId) {
    const pb = await prisma.botPlaybook.findFirst({ where: { id: data.playbookId, deletedAt: null } });
    if (!pb) throw new ErrorDeAgente("El playbook seleccionado no existe");
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
