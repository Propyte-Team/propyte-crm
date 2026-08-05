// CRUD de reglas de comentarios sociales. Mismo guard de roles que
// /api/admin/connectors. Las frases se guardan ya normalizadas: el matcher
// compara contra la forma normalizada y guardarlas así evita normalizar en
// cada comentario que entra.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { normalize } from "@/lib/comments/match";
import { commentRuleCreateSchema } from "@/server/comment-rules.schema";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

async function assertRole() {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) return null;
  return session;
}

/** P2021 = la tabla no existe: la migración manual aún no se aplicó. */
function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2021";
}

/**
 * P2002 = choque de índice único. El índice [connectorId, name] no considera
 * deletedAt, así que una regla borrada (soft delete) sigue "ocupando" su
 * nombre; sin este catch el error crudo de Postgres saldría como un 500.
 */
function isUniqueNameClash(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export async function GET() {
  const session = await assertRole();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const rules = await prisma.commentRule.findMany({
      where: { deletedAt: null },
      orderBy: [{ connectorId: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
      include: {
        connector: { select: { id: true, name: true, provider: true } },
        _count: { select: { logs: true } },
      },
    });
    return NextResponse.json({ data: rules });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ data: [] });
    console.error("[comment-rules] GET:", err);
    return NextResponse.json({ error: "Error al listar reglas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await assertRole();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = commentRuleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const connector = await prisma.leadConnector.findFirst({
    where: { id: parsed.data.connectorId, deletedAt: null },
    select: { id: true, provider: true },
  });
  if (!connector) return NextResponse.json({ error: "Conector no encontrado" }, { status: 404 });
  if (connector.provider !== "INSTAGRAM" && connector.provider !== "MESSENGER") {
    return NextResponse.json(
      { error: "El conector debe ser de Instagram o Messenger" },
      { status: 400 }
    );
  }

  const phrases = [...new Set(parsed.data.phrases.map(normalize).filter(Boolean))];
  if (phrases.length === 0) {
    return NextResponse.json({ error: "Las frases quedaron vacías al normalizar" }, { status: 400 });
  }

  // Colisión: dos reglas activas con la misma frase en la misma cuenta hacen
  // que una nunca dispare, sin ningún síntoma visible.
  const siblings = await prisma.commentRule.findMany({
    where: { connectorId: connector.id, deletedAt: null, isActive: true },
    select: { id: true, name: true, phrases: true, isActive: true },
  });
  // Filtro explícito además del `where`: la colisión solo importa entre
  // reglas ACTIVAS de la misma cuenta.
  const clash = siblings.find((s) => s.isActive && s.phrases.some((p) => phrases.includes(p)));
  if (clash) {
    return NextResponse.json(
      { error: `La regla activa "${clash.name}" ya usa una de esas frases` },
      { status: 409 }
    );
  }

  let rule;
  try {
    rule = await prisma.commentRule.create({
      data: {
        name: parsed.data.name,
        connectorId: connector.id,
        phrases,
        publicReplies: parsed.data.publicReplies,
        dmTemplate: parsed.data.dmTemplate,
        postFilter: parsed.data.postFilter,
        priority: parsed.data.priority,
        isActive: false, // nace en pausa, se activa explícitamente
      },
      select: { id: true, name: true, isActive: true },
    });
  } catch (err) {
    if (isUniqueNameClash(err)) {
      return NextResponse.json(
        { error: "Ya existe una regla con ese nombre en esa cuenta, aunque esté eliminada" },
        { status: 409 }
      );
    }
    throw err;
  }

  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: "CREATE",
        entity: "CommentRule",
        entityId: rule.id,
        changes: { name: rule.name, phrases },
      },
    })
    .catch(() => {});

  return NextResponse.json({ data: rule }, { status: 201 });
}
