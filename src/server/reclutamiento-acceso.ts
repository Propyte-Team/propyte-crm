// #926 — Puerta de la API de Reclutamiento: sesión + rol. Un solo sitio para las cinco rutas.
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { puedeVerReclutamiento } from "@/lib/reclutamiento/roles";

export type SesionReclutamiento = { user: { id: string; role: string; name?: string | null } };

export async function exigirReclutamiento(): Promise<
  { session: SesionReclutamiento } | { respuesta: NextResponse }
> {
  const session = (await getServerSession()) as SesionReclutamiento | null;
  if (!session?.user) return { respuesta: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!puedeVerReclutamiento(session.user.role)) {
    return { respuesta: NextResponse.json({ error: "No tienes acceso a Reclutamiento" }, { status: 403 }) };
  }
  return { session };
}
