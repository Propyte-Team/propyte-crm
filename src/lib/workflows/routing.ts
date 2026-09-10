// Motor de ruteo (Anexo Técnico §C.1 autoRouteLead) — aplica RoutingRule por prioridad,
// asigna asesor, crea SlaTimer FIRST_TOUCH y notifica. Emite lead.assigned.
import prisma from "@/lib/db";
import { evaluateConditions } from "./evaluate-conditions";
import { createSlaTimer, cumplirOrphan } from "./sla";
import { ROLES_RUTEABLES, usuarioRuteableWhere, mandoWhere } from "./ruteables";
import {
  motivoSinAsignar,
  explicacion,
  type MotivoSinAsignar,
  type PasoDeReparto,
} from "./routing-diagnostico";
import { withChangeSource } from "@/lib/audit/change-context";
import { createHash } from "crypto";

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

// #728: el turno se guarda POR LISTA DE CANDIDATOS, no en una clave global. Desde el
// ruteo por plaza (#704) las listas de dos plazas son disjuntas, así que un puntero
// compartido nunca pertenecía a la lista en curso: indexOf devolvía -1 y el turno
// colapsaba siempre en el primer asesor de cada plaza. Lo mismo ocurría entre reglas con
// distintos `targets.roles`/`targets.userIds` y cuando el territorio recortaba la lista.
// La huella de la lista cubre los cuatro casos de una vez.
function rrPointerKey(ruleId: string, userIds: string[]): string {
  const huella = createHash("sha1").update(userIds.join(",")).digest("hex").slice(0, 12);
  return `${RR_POINTER_KEY}:${ruleId}:${huella}`;
}

async function roundRobinPick(userIds: string[], ruleId: string): Promise<string | null> {
  if (userIds.length === 0) return null;
  const key = rrPointerKey(ruleId, userIds);
  const cfg = await prisma.systemConfig.findUnique({ where: { key } });
  const last = typeof cfg?.value === "string" ? cfg.value : "";
  const lastIdx = userIds.indexOf(last);
  // Explícito: sin puntero previo, o si el último elegido salió del pool, el turno
  // arranca en el primero. Antes esto pasaba por accidente aritmético: (-1 + 1) % n === 0.
  const next = userIds[lastIdx === -1 ? 0 : (lastIdx + 1) % userIds.length];
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value: next },
    create: { key, value: next },
  });
  return next;
}

// Pond (#678): un lead que ninguna regla pudo asignar NO se pierde en silencio —
// arranca su reloj de huérfano (tiempo real) y avisa a la gerencia de su plaza.
async function sendToPond(
  contact: { id: string; firstName: string; lastName: string; leadSource: string; targetPlaza: string | null },
  reason?: string,
  // #678 (a): POR QUÉ no se pudo asignar. Distinto de `reason`, que dice por qué se invocó
  // el reparto. Los cinco caminos de fallo terminaban en el mismo sitio y el evento solo
  // llevaba el motivo de quien llamaba, así que desde fuera no se podía distinguir
  // «no hay reglas» de «no hay a quién asignar».
  motivo?: MotivoSinAsignar,
): Promise<void> {
  await createSlaTimer(contact.id, "ORPHAN").catch((err) =>
    console.error("[routing] pond: no se pudo crear el SlaTimer ORPHAN:", err),
  );
  // #756: estas cuatro condiciones salieron a `./ruteables` sin cambiar de valor, porque el
  // aviso de vencimiento necesita EL MISMO mando y una segunda copia habría divergido —
  // el defecto de la #715 A-03, la #730 y la #682.
  const managerWhere = mandoWhere();
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
    motivo: motivo ?? null,
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
  // #678 (e): las tres condiciones salieron a `./ruteables` sin cambiar de valor, para que
  // la revisión diaria pueda publicar «cuántos asesores ruteables hay» con ESTE criterio y
  // no con una copia suya. Aquí siguen siendo las mismas.
  const excludedIds = await routingExcludedIds();
  const routableWhere = usuarioRuteableWhere();

  let assigneeId: string | null = null;
  // #678 (a): se anota por qué falla cada regla que SÍ matcheó, para poder decir después
  // cuál de los cinco motivos fue en vez de un `null` sin explicación.
  const pasos: PasoDeReparto[] = [];

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
      const roles: readonly string[] =
        Array.isArray(targets.roles) && targets.roles.length > 0 ? targets.roles : ROLES_RUTEABLES;
      // #729: sin plaza resoluble esta regla NO asigna. Antes el filtro simplemente no se
      // aplicaba y el lead se le entregaba a cualquier asesor de cualquier plaza; la
      // migración 2026-09-03-contact-target-plaza.sql declara lo contrario: sin plaza, al
      // Pond. Una regla que nombre su propia plaza (targets.plaza) sí puede tomarlo.
      const plazaEfectiva = targets.plaza ?? contact.targetPlaza;
      if (!plazaEfectiva) {
        pasos.push({ reglaId: rule.id, motivo: "sin_plaza_resoluble" });
        continue;
      }
      const users = await prisma.user.findMany({
        where: {
          role: { in: roles as never },
          ...routableWhere,
          ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}),
          plaza: plazaEfectiva as never,
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

    if (candidates.length === 0) {
      pasos.push({ reglaId: rule.id, motivo: "sin_candidatos_ruteables" });
      continue;
    }

    switch (rule.strategy) {
      case "ROUND_ROBIN":
        assigneeId = await roundRobinPick(candidates, rule.id);
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
    // Había candidatos y la estrategia devolvió null. Es el único de los cinco motivos que
    // sería un defecto de código y no un estado de los datos, así que conviene distinguirlo.
    pasos.push({ reglaId: rule.id, motivo: "estrategia_no_eligio" });
  }

  if (!assigneeId) {
    const motivo = motivoSinAsignar(pasos, rules.length);
    // #678 (a): el reparto deja de fallar en silencio. Antes solo quedaba el aviso a la
    // gerencia que manda el Pond, que hay que ir a mirar; esto queda en los registros del
    // servidor y en el payload del evento `lead.orphaned`, que es lo que permite contar
    // cuántos leads caen a cada motivo sin abrir el CRM.
    console.warn(
      `[routing] lead ${contact.id} sin asignar (${motivo}): ${explicacion(motivo)}` +
        ` · fuente=${contact.leadSource} plaza=${contact.targetPlaza ?? "sin plaza"}` +
        ` · reglas activas=${rules.length}, evaluadas sin asignar=${pasos.length}`,
    );
    await sendToPond(contact, opts.reason, motivo);
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

  // #753: el lead consiguió dueño, así que el reloj de la bandeja de rescate SÍ se cumple
  // aquí. Es el único sitio del reparto donde eso pasa, y hasta ahora lo cerraba cualquier
  // mensaje saliente (ver `meetSlaTimers`), que es otra pregunta.
  //
  // El fallo se reporta y no tumba la asignación, igual que el ORPHAN de `sendToPond`. Y la
  // dirección del fallo es la buena: si esto no corre, el temporizador se queda RUNNING y
  // acaba venciendo — una falsa alarma, que se mira. Lo contrario (dejarlo caer y perder la
  // notificación y el evento de asignación) rompería algo que el asesor sí espera.
  await cumplirOrphan(contactId).catch((err) =>
    console.error(`[routing] no se pudo cumplir el SlaTimer ORPHAN de ${contactId}:`, err),
  );

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
