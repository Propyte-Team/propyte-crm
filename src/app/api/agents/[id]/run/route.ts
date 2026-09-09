// Trigger de un agente — manual (asesor desde UI) o programático (motor/cron con CRON_SECRET).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { runAgent } from "@/lib/agents/runner";
import { secretosIgualesRecortados } from "@/lib/crypto/secretos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  // #736: esta es LA MISMA puerta de CRON_SECRET que la #665 blindó en lib/cron/auth.ts,
  // pero por un route que no pasa por ese guardia, así que se quedó con el `===`. No se usa
  // `rechazoCron` aquí porque este endpoint acepta DOS credenciales —sesión de usuario o
  // secreto de cron— y ese helper devuelve un 401 ya armado.
  const cronOk = secretosIgualesRecortados(
    req.headers.get("x-cron-secret"),
    process.env.CRON_SECRET
  );
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
