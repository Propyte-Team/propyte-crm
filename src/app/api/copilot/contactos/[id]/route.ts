// #988 — GET /api/copilot/contactos/:id — la cadencia de nuevos del contacto, para su ficha.
// { data: null } si nunca tuvo una (o si la migración aún no se corre).
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getContactAccessInfo } from "@/server/contacts";
import { cadenciaDeContacto } from "@/lib/copilot/cadencia-servicio";
import { esTablaSinMigrar } from "@/lib/copilot/sin-migrar";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const acceso = await getContactAccessInfo(id, session as never);
  if (!acceso.ok) {
    return NextResponse.json({ error: "No tienes acceso a este contacto" }, { status: acceso.reason === "not_found" ? 404 : 403 });
  }
  try {
    return NextResponse.json({ data: await cadenciaDeContacto(id) });
  } catch (err) {
    if (esTablaSinMigrar(err)) return NextResponse.json({ data: null });
    console.error("[copilot] cadencia del contacto:", err);
    return NextResponse.json({ error: "No se pudo leer la cadencia" }, { status: 500 });
  }
}
