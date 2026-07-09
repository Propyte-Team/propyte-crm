import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { mapLead, parseRules } from "@/lib/intake/map-lead";
import { mappingRuleSchema } from "@/lib/intake/mapping-model";
import { z } from "zod";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];
const bodySchema = z.object({
  rules: z.array(mappingRuleSchema),
  sample: z.object({ fieldData: z.record(z.unknown()).optional(), metadata: z.record(z.unknown()).optional() }).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  let fieldData = parsed.data.sample?.fieldData ?? {};
  let metadata = parsed.data.sample?.metadata ?? {};
  let usedLastLead = false;
  if (!parsed.data.sample) {
    const last = await prisma.connectorLeadLog.findFirst({
      where: { connectorId: id },
      orderBy: { receivedAt: "desc" },
      select: { rawPayload: true },
    });
    const raw = (last?.rawPayload ?? {}) as { external?: Record<string, unknown>; meta?: Record<string, unknown> };
    if (last) { fieldData = raw.external ?? {}; metadata = raw.meta ?? {}; usedLastLead = true; }
  }
  const mapped = mapLead(parsed.data.rules, { fieldData, metadata });
  return NextResponse.json({ data: { mapped, usedLastLead } });
}
