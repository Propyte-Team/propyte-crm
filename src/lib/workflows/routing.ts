// Motor de ruteo (Anexo Técnico §C.1 autoRouteLead) — aplica RoutingRule por prioridad,
// asigna asesor, crea SlaTimer FIRST_TOUCH y notifica. Emite lead.assigned.
import prisma from "@/lib/db";
import { evaluateConditions } from "./evaluate-conditions";
import { createSlaTimer } from "./sla";
import { withChangeSource } from "@/lib/audit/change-context";

const RR_POINTER_KEY = "workflows.routing.rr_pointer";
// AUD-20260710-09: el round-robin asignó un lead REAL a un usuario QA recién creado.
// Gate anti-test doble: lista configurable de ids excluidos (SystemConfig) + convención
// de correos internos/QA (dominio ".local": audit-temp@propyte.local, qa-asesor@propyte.local…).
const RR_EXCLUDED_KEY = "workflows.routing.excluded_user_ids";

async function routingExcludedIds(): Promise<string[]> {
  const cfg = await prisma.systemConfig.findUnique({ where: { key: RR_EXCLUDED_KEY } });
  if (!Array.isArray(cfg?.value)) return [];
  return (cfg.value as unknown[]).filter((v): v is string => typeof v === "string");
}

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

// Pond (#678): un lead que ninguna regla pudo asignar NO se pierde en silencio —
// arranca su reloj de huérfano (tiempo real) y avisa a la gerencia de su plaza.
async function sendToPond(
  contact: { id: string; firstName: string; lastName: string; leadSource: string; targetPlaza: string | null },
  reason?: string,
): Promise<void> {
  await createSlaTimer(contact.id, "ORPHAN").catch((err) =>
    console.error("[routing] pond: no se pudo crear el SlaTimer ORPHAN:", err),
  );
  const managerWhere = {
    role: { in: ["GERENTE", "DIRECTOR", "ADMIN"] as never },
    isActive: true,
    deletedAt: null,
    NOT: { email: { endsWith: ".local" } },
  };
  let managers = await prisma.user.findMany({
    where: { ...managerWhere, ...(contact.targetPlaza ? { plaza: contact.targetPlaza as never } : {}) },
    select: { id: true },
  });
  if (managers.length === 0) {
    // Sin gerencia en la plaza del lead: avisar a toda la gerencia para que no quede ciego.
    managers = await prisma.user.findMany({ where: managerWhere, select: { id: true } });
  }
  if (managers.length > 0) {
    await prisma.notification.createMany({
      data: managers.map((m) => ({
        userId: m.id,
        title: "Lead sin asignar (Pond)",
        message: `${contact.firstName} ${contact.lastName} (${contact.leadSource})${contact.targetPlaza ? ` · ${contact.targetPlaza}` : ""} — nadie disponible para tomarlo`,
        type: "lead_pond",
        link: `/contacts/${contact.id}`,
      })),
    });
  }
  const { emitEvent } = await import("./events");
  await emitEvent("lead.orphaned", "contact", contact.id, {
    reason: reason ?? null,
    plaza: contact.targetPlaza ?? null,
  });
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

  // Gate anti-test (AUD-20260710-09): usuarios QA/prueba jamás reciben leads reales.
  const excludedIds = await routingExcludedIds();
  const routableWhere = {
    isActive: true,
    deletedAt: null,
    NOT: { email: { endsWith: ".local" } },
  };

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
        where: {
          id: { in: targets.userIds, ...(excludedIds.length ? { notIn: excludedIds } : {}) },
          ...routableWhere,
        },
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
          ...routableWhere,
          ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}),
          ...((targets.plaza ?? contact.targetPlaza) ? { plaza: (targets.plaza ?? contact.targetPlaza) as never } : {}),
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

  if (!assigneeId) {
    await sendToPond(contact, opts.reason);
    return null;
  }

  const previous = contact.assignedToId;
  await withChangeSource(
    { source: "routing" },
    (tx) =>
      tx.contact.update({
        where: { id: contactId },
        data: { assignedToId: assigneeId, lastActivityAt: new Date() },
      })
  );

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
