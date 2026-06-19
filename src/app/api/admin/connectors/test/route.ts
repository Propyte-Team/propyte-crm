// Prueba de conexión: valida credenciales contra la API real. NO persiste nada.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { testConnection } from "@/lib/connectors/test-connection";
import { providerById } from "@/lib/connectors/registry";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

const schema = z.object({
  provider: z.string().min(1).refine((p) => providerById(p) !== undefined, "Proveedor desconocido"),
  credentials: z.record(z.string()),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ ok: false, detail: "No autorizado" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, detail: "Datos inválidos" }, { status: 400 });

  const result = await testConnection(parsed.data.provider, parsed.data.credentials);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
