import prisma from "@/lib/db";

export async function getQualifiedThreshold(): Promise<number> {
  const row = await prisma.systemConfig.findUnique({ where: { key: "capi.qualified_score_threshold" } }).catch(() => null);
  const n = row ? Number((row as { value?: unknown }).value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 70;
}
