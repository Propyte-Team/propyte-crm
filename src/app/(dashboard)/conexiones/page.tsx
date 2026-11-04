import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";
import { ConnectionsView } from "@/components/conexiones/connections-view";
import { countOrphanLeads } from "@/server/orphan-leads";
import { leadsUltimos30Dias } from "@/lib/connectors/actividad";
import { embeddedSignupAvailability } from "@/lib/whatsapp/coex/public-config";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

export default async function ConexionesPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  if (!ALLOWED_ROLES.includes(session.user.role)) redirect("/hoy");

  const [connectors, orphanCount] = await Promise.all([
    prisma.leadConnector.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, name: true, provider: true, status: true,
        lastLeadAt: true, errorCount: true, lastError: true, fieldMap: true,
        // 2026-10-14: estado de la coexistencia de WhatsApp (config.coex). Sin secretos.
        config: true,
        brandId: true, brand: { select: { id: true, name: true } },
        // 2026-10-14 (PR 2): números propios de asesores, con su dueño.
        scope: true, owner: { select: { id: true, name: true } },
        _count: { select: { leadLogs: true } },
      },
    }),
    // Aviso de «Leads huérfanos» (2026-10-12, entrega 3). Best-effort: null = sin número.
    countOrphanLeads(session.user),
  ]);

  // E6: prospectos de los últimos 30 días por cuenta (null = no se pudo contar).
  const por30d = await leadsUltimos30Dias(connectors.map((c) => c.id));

  return (
    <ConnectionsView
      initial={connectors.map((c) => ({
        ...c,
        lastLeadAt: c.lastLeadAt?.toISOString() ?? null,
        leads30d: por30d ? (por30d[c.id] ?? 0) : null,
      }))}
      orphanCount={orphanCount}
      // Se lee en cada petición (no en el build): ver lib/whatsapp/coex/public-config.ts.
      embeddedSignup={embeddedSignupAvailability()}
    />
  );
}
