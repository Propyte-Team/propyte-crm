"use server";

// Cobranza (Fase 3, T3.4): aging de parcialidades no pagadas con RBAC.
import prisma from "@/lib/db";

const OWN_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER"];
const TEAM_ROLES = ["TEAM_LEADER"];

export interface AgingBucket {
  key: string;
  label: string;
  count: number;
  total: number;
}
export interface CobranzaRow {
  id: string;
  contact: string;
  dueDate: string;
  amount: number;
  currency: string;
  daysOverdue: number;
  advisor: string;
}
export interface CobranzaData {
  buckets: AgingBucket[];
  overdue: CobranzaRow[];
  totalOverdue: number;
}

async function ownerIds(userId: string, role: string): Promise<string[] | undefined> {
  if (OWN_ROLES.includes(role)) return [userId];
  if (TEAM_ROLES.includes(role)) {
    const team = await prisma.user.findMany({ where: { teamLeaderId: userId }, select: { id: true } });
    return [userId, ...team.map((t) => t.id)];
  }
  return undefined;
}

export async function getCobranza(userId: string, role: string): Promise<CobranzaData> {
  const empty: CobranzaData = { buckets: [], overdue: [], totalOverdue: 0 };
  try {
    const owners = await ownerIds(userId, role);
    const dealScope = owners ? { assignedToId: { in: owners } } : {};

    const schedules = await prisma.paymentSchedule.findMany({
      where: {
        status: { in: ["PENDIENTE", "VENCIDA"] as never },
        plan: { quote: { deletedAt: null, deal: dealScope } },
      },
      select: {
        id: true, dueDate: true, amount: true,
        plan: {
          select: {
            quote: {
              select: {
                currency: true,
                deal: { select: { contact: { select: { firstName: true, lastName: true } }, assignedTo: { select: { name: true } } } },
              },
            },
          },
        },
      },
      orderBy: { dueDate: "asc" },
      take: 1000,
    });

    const now = Date.now();
    const buckets: Record<string, AgingBucket> = {
      upcoming: { key: "upcoming", label: "Por vencer", count: 0, total: 0 },
      d30: { key: "d30", label: "1–30 días", count: 0, total: 0 },
      d60: { key: "d60", label: "31–60 días", count: 0, total: 0 },
      d90: { key: "d90", label: "61–90 días", count: 0, total: 0 },
      d90plus: { key: "d90plus", label: "90+ días", count: 0, total: 0 },
    };
    const overdue: CobranzaRow[] = [];
    let totalOverdue = 0;

    for (const s of schedules) {
      const amount = Number(s.amount);
      const days = Math.floor((now - new Date(s.dueDate).getTime()) / 86400000);
      let key: keyof typeof buckets;
      if (days <= 0) key = "upcoming";
      else if (days <= 30) key = "d30";
      else if (days <= 60) key = "d60";
      else if (days <= 90) key = "d90";
      else key = "d90plus";
      buckets[key].count += 1;
      buckets[key].total += amount;

      if (days > 0) {
        totalOverdue += amount;
        const q = s.plan?.quote;
        const c = q?.deal?.contact;
        overdue.push({
          id: s.id,
          contact: c ? `${c.firstName} ${c.lastName}` : "—",
          dueDate: new Date(s.dueDate).toISOString(),
          amount,
          currency: q?.currency ?? "MXN",
          daysOverdue: days,
          advisor: q?.deal?.assignedTo?.name ?? "—",
        });
      }
    }

    return {
      buckets: Object.values(buckets),
      overdue: overdue.sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 100),
      totalOverdue,
    };
  } catch (err) {
    console.error("[cobranza] getCobranza falló:", err);
    return empty;
  }
}
