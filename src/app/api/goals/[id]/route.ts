import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { deleteGoal } from "@/server/goals";

const SET_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"];

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!SET_ROLES.includes(session.user.role as string)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  try {
    await deleteGoal(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/goals/[id]]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
