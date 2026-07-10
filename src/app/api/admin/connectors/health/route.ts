// GET diagnóstico: por conector social, si los 3 campos están presentes. NUNCA devuelve valores de secretos.
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { checkSocialConnector } from "@/lib/messaging/connector-health";

export const dynamic = "force-dynamic";
const ALLOWED = ["ADMIN", "DIRECTOR", "GERENTE"];

export async function GET() {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const connectors = await prisma.leadConnector.findMany({
    where: { provider: { in: ["INSTAGRAM", "MESSENGER"] }, deletedAt: null },
    orderBy: { name: "asc" },
  });
  const data = connectors.map((c) => {
    const h = checkSocialConnector(c);
    return { id: c.id, name: c.name, provider: c.provider, status: c.status, ok: h.ok, missing: h.missing };
  });
  return NextResponse.json({ data });
}
