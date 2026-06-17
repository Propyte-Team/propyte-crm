import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { findDuplicateGroups } from "@/server/contacts-dedup";

const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER_EXT", "MANTENIMIENTO"];

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!FULL_ACCESS_ROLES.includes(session.user.role as string)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const data = await findDuplicateGroups();
  return NextResponse.json({ data });
}
