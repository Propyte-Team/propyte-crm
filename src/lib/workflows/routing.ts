// Motor de ruteo (Anexo Técnico §C.1 autoRouteLead) — aplica RoutingRule por prioridad,
// asigna asesor, crea SlaTimer FIRST_TOUCH y notifica. Emite lead.assigned.
import prisma from "@/lib/db";
import { evaluateConditions } from "./evaluate-conditions";
import { createSlaTimer } from "./sla";

const RR_POINTER_KEY = "workflows.routing.rr_pointer";

async function roundRobinPick(userIds: string[]): Promise<string | null> {
  if (userIds.length === 0) return null;
  const cfg = await prisma.systemConfig.findUnique({ where: { key: RR_POINTER_KEY } });
  const last = typeof cfg?.value === "string" ? cfg.value : "";
  const lastIdx = userIds.indexOf(last);
  const next = userIds[(lastIdx + 1) % userIds.length];
  await prisma.systemConfig.upsert({
    where: { key: RR_POINTER_KEY },
    update: { value: next },
    create: { key: RR_POINTER_KEY, value: next },
  });
  return next;
}

export async function autoRouteLead(
  contactId: string,
  opts: { reason?: string } = {}
): Promise<string | null> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, include: { adAttribution: true } });
  if (!contact || contact.deletedAt) return null;

  // PRIMERO territorio (speckit Personalización §2.4): si una TerritoryRule matchea,
  // los candidatos se restringen a los miembros del territorio ganador.
  let territoryUserIds: string[] | null = null;
  let territoryName: string | null = null;
  try {
    const { resolveTerritoryForContact } = await import("@/lib/teams/territory");
    const territory = await resolveTerritoryForContact(contact);
    if (territory && territory.memberUserIds.length > 0) {
      territoryUserIds = territory.memberUserIds;
      territoryName = territory.territoryName;
    }
  } catch {
    // tablas P1 sin migrar todavía → ruteo clásico
  }

  const rules = await prisma.routingRule.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { priority: "asc" },
  });

  let assigneeId: string | null = null;
  for (const rule of rules) {
    const ctx = {
      contact: { ...contact, score: Number(contact.score) },
      adAttribution: (contact as { adAttribution?: unknown }).adAttribution ?? null,
    };
    if (!evaluateConditions(rule.conditions as never, ctx)) continue;

    const targets = (rule.targets ?? {}) as { roles?: string[]; userIds?: string[]; plaza?: string };
    let candidates: string[] = [];
    if (Array.isArray(targets.userIds) && targets.userIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: targets.userIds }, isActive: true, deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      candidates = users.map((u) => u.id);
    } else {
      const roles = Array.isArray(targets.roles) && targets.roles.length > 0
        ? targets.roles
        : ["ASESOR", "ASESOR_SR", "ASESOR_JR"];
      const users = await prisma.user.findMany({
        where: {
          role: { in: roles as never },
          isActive: true,
          deletedAt: null,
          ...(targets.plaza ? { plaza: targets.plaza as never } : {}),
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      candidates = users.map((u) => u.id);
    }

    // Intersección con el territorio resuelto (estrategia DENTRO del territorio, §2.4)
    if (territoryUserIds) {
      const inTerritory = candidates.filter((id) => territoryUserIds!.includes(id));
      if (inTerritory.length > 0) candidates = inTerritory;
    }

    if (candidates.length === 0) continue;

    switch (rule.strategy) {
      case "ROUND_ROBIN":
        assigneeId = await roundRobinPick(candidates);
        break;
      case "PERFORMANCE": {
        // Menos contactos activos = mejor candidato (proxy de capacidad)
        const withCounts = await prisma.user.findMany({
          where: { id: { in: candidates } },
          select: { id: true, _count: { select: { assignedContacts: { where: { deletedAt: null } } } } },
          orderBy: { assignedContacts: { _count: "asc" } },
        });
        assigneeId = withCounts[0]?.id ?? null;
        break;
      }
      case "GUARDIA":
      case "MANUAL":
      default:
        assigneeId = candidates[0] ?? null;
    }
    if (assigneeId) break;
  }

  if (!assigneeId) return null;

  const previous = contact.assignedToId;
  await prisma.contact.update({
    where: { id: contactId },
    data: { assignedToId: assigneeId, lastActivityAt: new Date() },
  });

  await createSlaTimer(contactId, "FIRST_TOUCH");

  await prisma.notification.create({
    data: {
      userId: assigneeId,
      title: previous ? "Lead re-asignado" : "Lead nuevo asignado",
      message: `${contact.firstName} ${contact.lastName} (${contact.leadSource})${opts.reason ? ` — ${opts.reason}` : ""}`,
      type: "lead_assigned",
      link: `/contacts/${contactId}`,
    },
  });

  // Import dinámico para evitar ciclo events→engine→actions→routing→events
  const { emitEvent } = await import("./events");
  await emitEvent(previous ? "lead.reassigned" : "lead.assigned", "contact", contactId, {
    assigneeId,
    previousAssigneeId: previous,
    reason: opts.reason,
    territory: territoryName,
  });

  return assigneeId;
}
