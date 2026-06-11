// Trigger de un agente — manual (asesor desde UI) o programático (motor/cron con CRON_SECRET).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { runAgent } from "@/lib/agents/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  const cronOk = req.headers.get("x-cron-secret")?.trim() === process.env.CRON_SECRET?.trim() && !!process.env.CRON_SECRET;
  if (!session?.user && !cronOk) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const schema = z.object({
    trigger: z.string().default(session?.user ? "manual" : "cron"),
    input: z.record(z.unknown()).default({}),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const result = await runAgent(params.id, parsed.data.trigger, parsed.data.input);
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 422 }
    );
  }
}
