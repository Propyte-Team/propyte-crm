// Página principal del portal de desarrollador externo
// Server component que obtiene datos y renderiza el dashboard
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getPortalDashboard } from "@/server/portal";
import { PortalDashboard } from "@/components/portal/portal-dashboard";

export default async function PortalPage() {
  // Verificar sesión y rol
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "DEVELOPER_EXT") {
    redirect("/dashboard");
  }

  // Obtener datos del dashboard
  const dashboardData = await getPortalDashboard(session.user.id);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">
        Portal de Desarrollador
      </h1>
      <PortalDashboard data={dashboardData} />
    </div>
  );
}
