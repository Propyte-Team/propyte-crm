import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { MetasClient } from "@/components/goals/metas-client";

export const dynamic = "force-dynamic";

export default async function MetasPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  const SET_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"];
  const canEdit = SET_ROLES.includes(session.user.role as string);
  return (
    <MetasClient
      canEdit={canEdit}
      selfUserId={session.user.id}
      role={session.user.role as string}
    />
  );
}
