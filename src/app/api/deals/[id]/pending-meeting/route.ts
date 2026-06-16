import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getLatestPendingMeeting } from "@/server/activities";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const data = await getLatestPendingMeeting(params.id);
  return NextResponse.json({ data });
}
