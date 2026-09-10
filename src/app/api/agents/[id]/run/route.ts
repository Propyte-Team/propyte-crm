// Trigger de un agente — manual (asesor desde UI) o programático (motor/cron con CRON_SECRET).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { runAgent } from "@/lib/agents/runner";
import { secretosIgualesRecortados } from "@/lib/crypto/secretos";
import { puedeCorrerAgentes, inputFueraDeTope } from "@/lib/agents/permisos";

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

  // #714 (S-03): tener sesión no era permiso. Un agente manda WhatsApp a personas reales y
  // da de alta contactos, así que el permiso va por rol — ver `lib/agents/permisos.ts`,
  // donde está escrito por qué son ADMIN y DIRECTOR y cómo añadir otro.
  //
  // El orden importa: primero cron, porque el motor no tiene rol. Y solo se comprueba el
  // rol cuando la credencial fue la sesión: un `cronOk` válido ya pasó su propia puerta.
  if (!cronOk && !puedeCorrerAgentes(session?.user?.role)) {
    return NextResponse.json(
      { error: "Tu rol no puede ejecutar agentes" },
      { status: 403 },
    );
  }

  const schema = z.object({
    trigger: z.string().default(session?.user ? "manual" : "cron"),
    input: z.record(z.unknown()).default({}),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // #714 (S-03), la otra mitad: `z.record(z.unknown())` acepta cualquier objeto de
  // cualquier tamaño, y ese objeto acaba dentro del prompt del modelo. El tope acota el
  // coste y el espacio de una inyección; no la impide (eso lo hace la puerta de rol).
  const fuera = inputFueraDeTope(parsed.data.input);
  if (fuera) return NextResponse.json({ error: fuera.motivo }, { status: 400 });

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
