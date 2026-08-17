// Editar, activar/pausar y borrar (soft) una regla de comentarios.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { normalize } from "@/lib/comments/match";
import { commentRuleUpdateSchema } from "@/server/comment-rules.schema";
import { canManageCommentRules } from "@/lib/comments/roles";

async function assertRole() {
  const session = await getServerSession();
  if (!session?.user || !canManageCommentRules(session.user.role)) return null;
  return session;
}

/**
 * P2002 = choque de índice único. El índice [connectorId, name] no considera
 * deletedAt, así que una regla borrada (soft delete) sigue "ocupando" su
 * nombre; sin este catch el error crudo de Postgres saldría como un 500.
 */
function isUniqueNameClash(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await assertRole();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = commentRuleUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const current = await prisma.commentRule.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { id: true, connectorId: true, phrases: true },
  });
  if (!current) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  const phrases = parsed.data.phrases
    ? [...new Set(parsed.data.phrases.map(normalize).filter(Boolean))]
    : current.phrases;
  if (phrases.length === 0) {
    return NextResponse.json({ error: "Las frases quedaron vacías al normalizar" }, { status: 400 });
  }

  // La colisión solo importa entre reglas ACTIVAS de la misma cuenta.
  const willBeActive = parsed.data.isActive ?? undefined;
  if (willBeActive !== false) {
    const siblings = await prisma.commentRule.findMany({
      where: {
        connectorId: current.connectorId,
        deletedAt: null,
        isActive: true,
        id: { not: current.id },
      },
      select: { name: true, phrases: true, isActive: true },
    });
    const clash = siblings.find((s) => s.isActive && s.phrases.some((p) => phrases.includes(p)));
    if (clash) {
      return NextResponse.json(
        { error: `La regla activa "${clash.name}" ya usa una de esas frases` },
        { status: 409 }
      );
    }
  }

  let rule;
  try {
    rule = await prisma.commentRule.update({
      where: { id: current.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.phrases !== undefined ? { phrases } : {}),
        ...(parsed.data.publicReplies !== undefined
          ? { publicReplies: parsed.data.publicReplies }
          : {}),
        ...(parsed.data.dmTemplate !== undefined ? { dmTemplate: parsed.data.dmTemplate } : {}),
        ...(parsed.data.postFilter !== undefined ? { postFilter: parsed.data.postFilter } : {}),
        ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
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
        action: "UPDATE",
        entity: "CommentRule",
        entityId: rule.id,
        changes: parsed.data as object,
      },
    })
    .catch(() => {});

  return NextResponse.json({ data: rule });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await assertRole();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const rule = await prisma.commentRule.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!rule) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  // Soft delete: el log conserva ruleId con ON DELETE SET NULL solo si se
  // borrara de verdad; en soft delete el historial queda íntegro.
  await prisma.commentRule.update({
    where: { id: rule.id },
    data: { deletedAt: new Date(), isActive: false },
  });

  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: "DELETE",
        entity: "CommentRule",
        entityId: rule.id,
        changes: { name: rule.name },
      },
    })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
