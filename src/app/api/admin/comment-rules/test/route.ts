// Dry-run del matcher: qué regla ganaría y con qué textos. CERO llamadas a
// Graph — desde el probador es imposible publicar algo por accidente.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { matchRule, findExclusion } from "@/lib/comments/match";
import { renderTemplate, pickVariant } from "@/lib/comments/template";
import { canManageCommentRules } from "@/lib/comments/roles";

const schema = z.object({
  connectorId: z.string().min(1),
  commentText: z.string().min(1).max(2000),
  postId: z.string().max(120).optional(),
  usuario: z.string().max(80).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !canManageCommentRules(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { connectorId, commentText, usuario } = parsed.data;
  const postId = parsed.data.postId ?? "__PRUEBA__";

  const rules = await prisma.commentRule.findMany({
    where: { connectorId, deletedAt: null },
  });

  const active = rules.filter((r) => r.isActive);
  const hit = matchRule(active, commentText, postId);

  if (!hit) {
    // Nada activo coincide. Las dos explicaciones posibles se devuelven juntas
    // porque contestan el mismo "¿por qué no disparó?": una regla en pausa que
    // sí habría ganado, o una activa que ganó y se cayó por una negativa. Sin
    // la segunda, una negativa mal puesta se ve idéntica a no tener regla.
    const paused = matchRule(
      rules.filter((r) => !r.isActive),
      commentText,
      postId
    );
    const veto = findExclusion(active, commentText, postId);
    return NextResponse.json({
      match: null,
      pausedMatch: paused
        ? { ruleId: paused.rule.id, ruleName: paused.rule.name, phrase: paused.phrase }
        : null,
      excluded: veto
        ? {
            ruleId: veto.rule.id,
            ruleName: veto.rule.name,
            phrase: veto.phrase,
            excludedBy: veto.excludedBy,
          }
        : null,
    });
  }

  // Mismo conteo que usa el motor: el probador enseña la variante real.
  const fired = await prisma.commentRuleLog.count({
    where: { ruleId: hit.rule.id, publicReplyStatus: "SENT" },
  });
  const vars = { usuario: usuario ?? null };

  return NextResponse.json({
    match: {
      ruleId: hit.rule.id,
      ruleName: hit.rule.name,
      phrase: hit.phrase,
      publicText: renderTemplate(pickVariant(hit.rule.publicReplies, fired) ?? "", vars),
      dmText: renderTemplate(hit.rule.dmTemplate, vars),
    },
    pausedMatch: null,
    excluded: null,
  });
}
