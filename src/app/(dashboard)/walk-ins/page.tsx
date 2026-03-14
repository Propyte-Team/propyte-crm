// Página de registro de walk-ins — server component
// Obtiene walk-ins de hoy y asesores disponibles desde la BD

import { getServerSession } from "@/lib/auth/session";
import { getWalkIns, getAvailableAdvisors } from "@/server/walk-ins";
import { WalkInsContent } from "@/components/walk-ins/walk-ins-content";
import { redirect } from "next/navigation";

export default async function WalkInsPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // Obtener walk-ins de hoy y asesores disponibles en paralelo
  const [walkIns, advisors] = await Promise.all([
    getWalkIns(),
    getAvailableAdvisors(session.user.plaza),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Registro de Walk-ins
        </h1>
        <p className="text-muted-foreground">
          Registra y gestiona visitantes presenciales
        </p>
      </div>

      {/* Contenido interactivo */}
      <WalkInsContent
        initialWalkIns={walkIns}
        advisors={advisors}
        userRole={session.user.role}
        userPlaza={session.user.plaza}
      />
    </div>
  );
}
