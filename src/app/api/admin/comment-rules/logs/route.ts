// Log de comentarios que dispararon regla. Filtros por regla y por estado.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

// Pareado a propósito con el guard de /admin/page.tsx (ADMIN, DIRECTOR,
// GERENTE): la UI de esta feature vive en /admin?tab=comments, así que la API
// no debe conceder más acceso del que esa página deja ver.
const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];
const PAGE_SIZE_MAX = 100;

/** `Number("abc")` es NaN, y `Math.max`/`Math.min` con un NaN de por medio dan NaN:
 * Prisma recibiría `take: NaN` y lanzaría, cayendo al catch genérico como 500. */
function parsePositiveInt(raw: string | null, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(req.url);
  const ruleId = url.searchParams.get("ruleId");
  const onlyFailed = url.searchParams.get("failed") === "1";
  const page = parsePositiveInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, parsePositiveInt(url.searchParams.get("pageSize"), 25));

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
