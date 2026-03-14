// ============================================================
// Server Actions: Plan de Carrera
// Consulta de progreso del asesor y KPIs de rendimiento
// ============================================================

"use server";

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { CAREER_REQUIREMENTS } from "@/lib/constants";

// Orden de niveles para determinar el siguiente nivel
const CAREER_ORDER: Array<keyof typeof CAREER_REQUIREMENTS> = [
  "JR",
  "SR",
  "TOP_PRODUCER",
  "TEAM_LEADER",
  "GERENTE",
];

// --- Interfaz de requisito individual ---
interface CareerRequirement {
  label: string;
  current: number;
  required: number;
  met: boolean;
  unit: string;
}

// --- Interfaz de progreso de carrera ---
export interface CareerProgress {
  currentLevel: string;
  currentLevelLabel: string;
  nextLevel: string | null;
  nextLevelLabel: string | null;
  requirements: CareerRequirement[];
  allRequirementsMet: boolean;
}

// --- Interfaz de KPIs mensuales ---
export interface CareerKPIs {
  dealsPerMonth: Array<{ month: string; count: number }>;
  totalCommissions: number;
  conversionRateTrend: Array<{ month: string; rate: number }>;
  quarterDeals: number;
  conversionRate: number;
  activityCompliance: number;
  sedetusValid: boolean;
  sedetusExpiry: string | null;
}

/**
 * Obtiene las fechas de inicio y fin del trimestre actual.
 */
function getCurrentQuarterDates(): { start: Date; end: Date } {
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3);
  const start = new Date(now.getFullYear(), quarter * 3, 1);
  const end = new Date(now.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * Obtiene el inicio de la semana (lunes) para una fecha dada.
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Calcula el compliance promedio de actividad de las últimas 12 semanas.
 * Se basa en contactos salientes diarios como métrica principal.
 */
async function calculateActivityCompliance(userId: string): Promise<number> {
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  // Contar actividades de contacto salientes agrupadas por semana
  const activities = await prisma.activity.findMany({
    where: {
      userId,
      deletedAt: null,
      activityType: {
        in: [
          "CALL_OUTBOUND",
          "WHATSAPP_OUT",
          "EMAIL_SENT",
          "FOLLOW_UP",
          "MEETING_VIRTUAL",
          "MEETING_PRESENTIAL",
          "MEETING_SHOWROOM",
        ],
      },
      completedAt: { gte: threeMonthsAgo, lte: now },
    },
    select: { completedAt: true },
  });

  if (activities.length === 0) return 0;

  // Agrupar por semana y calcular compliance
  const weekMap = new Map<string, number>();
  for (const act of activities) {
    if (!act.completedAt) continue;
    const ws = getWeekStart(act.completedAt);
    const key = ws.toISOString().split("T")[0];
    weekMap.set(key, (weekMap.get(key) || 0) + 1);
  }

  // Meta semanal: 15 contactos/día * 5 días = 75 actividades/semana (estimado)
  const weeklyTarget = 75;
  const weeks = Array.from(weekMap.values());
  if (weeks.length === 0) return 0;

  const avgCompliance =
    weeks.reduce((sum, count) => sum + Math.min((count / weeklyTarget) * 100, 100), 0) /
    weeks.length;

  return Math.round(avgCompliance);
}

/**
 * Obtiene el progreso de carrera del usuario.
 * Incluye nivel actual, siguiente nivel, y requisitos con progreso detallado.
 */
export async function getCareerProgress(
  userId: string
): Promise<CareerProgress> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  // Obtener datos del usuario
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      careerLevel: true,
      sedetusExpiry: true,
      createdAt: true,
    },
  });

  if (!user) throw new Error("Usuario no encontrado");

  const currentLevel = user.careerLevel;
  const currentIndex = CAREER_ORDER.indexOf(currentLevel as keyof typeof CAREER_REQUIREMENTS);
  const nextLevel =
    currentIndex < CAREER_ORDER.length - 1 ? CAREER_ORDER[currentIndex + 1] : null;

  const currentConfig = CAREER_REQUIREMENTS[currentLevel as keyof typeof CAREER_REQUIREMENTS];
  const nextConfig = nextLevel ? CAREER_REQUIREMENTS[nextLevel] : null;

  if (!nextConfig) {
    // Ya está en el nivel máximo
    return {
      currentLevel,
      currentLevelLabel: currentConfig?.label || currentLevel,
      nextLevel: null,
      nextLevelLabel: null,
      requirements: [],
      allRequirementsMet: false,
    };
  }

  // --- Calcular progreso de cada requisito ---
  const { start: quarterStart, end: quarterEnd } = getCurrentQuarterDates();

  // Deals cerrados este trimestre
  const quarterDeals = await prisma.deal.count({
    where: {
      assignedToId: userId,
      stage: "WON",
      actualCloseDate: { gte: quarterStart, lte: quarterEnd },
      deletedAt: null,
    },
  });

  // Total de deals acumulados (ganados)
  const totalWonDeals = await prisma.deal.count({
    where: {
      assignedToId: userId,
      stage: "WON",
      deletedAt: null,
    },
  });

  // Total de deals (para tasa de conversión)
  const totalDeals = await prisma.deal.count({
    where: {
      assignedToId: userId,
      deletedAt: null,
    },
  });

  const conversionRate = totalDeals > 0 ? (totalWonDeals / totalDeals) * 100 : 0;

  // Compliance de actividades
  const activityCompliance = await calculateActivityCompliance(userId);

  // SEDETUS vigente
  const sedetusValid =
    user.sedetusExpiry != null && new Date(user.sedetusExpiry) > new Date();

  // Meses en la empresa
  const monthsInCompany = Math.floor(
    (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30)
  );

  // Construir lista de requisitos con progreso
  const requirements: CareerRequirement[] = [
    {
      label: "Cierres acumulados",
      current: totalWonDeals,
      required: nextConfig.minDeals,
      met: totalWonDeals >= nextConfig.minDeals,
      unit: "cierres",
    },
    {
      label: "Meses en la empresa",
      current: monthsInCompany,
      required: nextConfig.minMonths,
      met: monthsInCompany >= nextConfig.minMonths,
      unit: "meses",
    },
    {
      label: "Tasa de conversión",
      current: Math.round(conversionRate * 10) / 10,
      required: 15,
      met: conversionRate >= 15,
      unit: "%",
    },
    {
      label: "Compliance de actividades",
      current: activityCompliance,
      required: 80,
      met: activityCompliance >= 80,
      unit: "%",
    },
    {
      label: "SEDETUS vigente",
      current: sedetusValid ? 1 : 0,
      required: 1,
      met: sedetusValid,
      unit: "",
    },
    {
      label: "Cierres del trimestre",
      current: quarterDeals,
      required: Math.max(Math.ceil(nextConfig.minDeals / 4), 2),
      met: quarterDeals >= Math.max(Math.ceil(nextConfig.minDeals / 4), 2),
      unit: "cierres",
    },
  ];

  const allRequirementsMet = requirements.every((r) => r.met);

  return {
    currentLevel,
    currentLevelLabel: currentConfig?.label || currentLevel,
    nextLevel,
    nextLevelLabel: nextConfig.label,
    requirements,
    allRequirementsMet,
  };
}

/**
 * Obtiene KPIs mensuales del asesor para la vista de carrera.
 * Incluye deals por mes, comisiones acumuladas y tendencia de conversión.
 */
export async function getCareerKPIs(userId: string): Promise<CareerKPIs> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  // Obtener datos del usuario para SEDETUS
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sedetusExpiry: true },
  });

  // Deals ganados en los últimos 6 meses con fecha de cierre
  const wonDeals = await prisma.deal.findMany({
    where: {
      assignedToId: userId,
      stage: "WON",
      actualCloseDate: { gte: sixMonthsAgo },
      deletedAt: null,
    },
    select: {
      actualCloseDate: true,
      commissionAdvisor: true,
      estimatedValue: true,
    },
    orderBy: { actualCloseDate: "asc" },
  });

  // Agrupar por mes
  const monthMap = new Map<string, { count: number; commission: number }>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthMap.set(key, { count: 0, commission: 0 });
  }

  for (const deal of wonDeals) {
    if (!deal.actualCloseDate) continue;
    const d = new Date(deal.actualCloseDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const entry = monthMap.get(key);
    if (entry) {
      entry.count += 1;
      entry.commission += Number(deal.commissionAdvisor || 0);
    }
  }

  const dealsPerMonth = Array.from(monthMap.entries()).map(([month, data]) => ({
    month,
    count: data.count,
  }));

  // Comisiones totales acumuladas
  const commissionResult = await prisma.deal.aggregate({
    where: {
      assignedToId: userId,
      stage: "WON",
      deletedAt: null,
    },
    _sum: { commissionAdvisor: true },
  });
  const totalCommissions = Number(commissionResult._sum.commissionAdvisor || 0);

  // Tasa de conversión por mes (últimos 6 meses)
  const conversionRateTrend: Array<{ month: string; rate: number }> = [];
  const monthKeys = Array.from(monthMap.keys());
  for (const month of monthKeys) {
    const [year, mon] = month.split("-").map(Number);
    const monthStart = new Date(year, mon - 1, 1);
    const monthEnd = new Date(year, mon, 0, 23, 59, 59, 999);

    const [wonCount, totalCount] = await Promise.all([
      prisma.deal.count({
        where: {
          assignedToId: userId,
          stage: "WON",
          actualCloseDate: { gte: monthStart, lte: monthEnd },
          deletedAt: null,
        },
      }),
      prisma.deal.count({
        where: {
          assignedToId: userId,
          createdAt: { gte: monthStart, lte: monthEnd },
          deletedAt: null,
        },
      }),
    ]);

    conversionRateTrend.push({
      month,
      rate: totalCount > 0 ? Math.round((wonCount / totalCount) * 100) : 0,
    });
  }

  // KPIs del trimestre actual
  const { start: quarterStart, end: quarterEnd } = getCurrentQuarterDates();
  const quarterDeals = await prisma.deal.count({
    where: {
      assignedToId: userId,
      stage: "WON",
      actualCloseDate: { gte: quarterStart, lte: quarterEnd },
      deletedAt: null,
    },
  });

  // Tasa de conversión global
  const [globalWon, globalTotal] = await Promise.all([
    prisma.deal.count({
      where: { assignedToId: userId, stage: "WON", deletedAt: null },
    }),
    prisma.deal.count({
      where: { assignedToId: userId, deletedAt: null },
    }),
  ]);
  const conversionRate = globalTotal > 0 ? Math.round((globalWon / globalTotal) * 100) : 0;

  // Compliance de actividades
  const activityCompliance = await calculateActivityCompliance(userId);

  // SEDETUS
  const sedetusValid =
    user?.sedetusExpiry != null && new Date(user.sedetusExpiry) > new Date();

  return {
    dealsPerMonth,
    totalCommissions,
    conversionRateTrend,
    quarterDeals,
    conversionRate,
    activityCompliance,
    sedetusValid,
    sedetusExpiry: user?.sedetusExpiry?.toISOString() || null,
  };
}
