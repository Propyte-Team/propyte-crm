// Log de comentarios que dispararon regla. Filtros por regla y por estado.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];
const PAGE_SIZE_MAX = 100;

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(req.url);
  const ruleId = url.searchParams.get("ruleId");
  const onlyFailed = url.searchParams.get("failed") === "1";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(PAGE_SIZE_MAX, Number(url.searchParams.get("pageSize") ?? 25));

  const where = {
    ...(ruleId ? { ruleId } : {}),
    ...(onlyFailed
      ? { OR: [{ publicReplyStatus: "FAILED" as const }, { dmStatus: "FAILED" as const }] }
      : {}),
  };

  try {
    const [rows, total] = await Promise.all([
      prisma.commentRuleLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          rule: { select: { id: true, name: true } },
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.commentRuleLog.count({ where }),
    ]);
    return NextResponse.json({ data: rows, total, page, pageSize });
  } catch (err) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2021") {
      return NextResponse.json({ data: [], total: 0, page, pageSize });
    }
    console.error("[comment-rules] logs GET:", err);
    return NextResponse.json({ error: "Error al listar el log" }, { status: 500 });
  }
}
