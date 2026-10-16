import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { deleteGoal, metaVisible } from "@/server/goals";
import { puedeFijarMetas, puedeFijarMetasEmpresa } from "@/lib/rbac/goal-scope";

/**
 * DELETE /api/goals/[id]
 *
 * #895: antes bastaba el rol para borrar cualquier meta por id. Ahora la meta tiene que estar
 * dentro del alcance (si no, 404: no se confirma que existe) y las de la empresa solo las
 * borran ADMIN y DIRECTOR.
 */
export async function DELETE(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const role = session.user.role as string;
  if (!puedeFijarMetas(role)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  try {
    const meta = await metaVisible({ id: session.user.id, role, plaza: session.user.plaza }, params.id);
    if (!meta) return NextResponse.json({ error: "Meta no encontrada" }, { status: 404 });
    if (meta.scope === "COMPANY" && !puedeFijarMetasEmpresa(role)) {
      return NextResponse.json({ error: "Solo dirección borra las metas de la empresa" }, { status: 403 });
    }
    await deleteGoal(meta.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/goals/[id]]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
