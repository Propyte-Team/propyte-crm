import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";
import { ConnectionsView } from "@/components/conexiones/connections-view";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

export default async function ConexionesPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  if (!ALLOWED_ROLES.includes(session.user.role)) redirect("/dashboard");

  const connectors = await prisma.leadConnector.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, provider: true, status: true,
      lastLeadAt: true, errorCount: true, lastError: true,
      _count: { select: { leadLogs: true } },
    },
  });

  return (
    <ConnectionsView
      initial={connectors.map((c) => ({
        ...c,
        lastLeadAt: c.lastLeadAt?.toISOString() ?? null,
      }))}
    />
  );
}
