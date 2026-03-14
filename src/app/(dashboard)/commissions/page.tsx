// Página de comisiones — server component
// Obtiene datos de comisiones desde la BD y los pasa al componente cliente

import { getServerSession } from "@/lib/auth/session";
import { getCommissions } from "@/server/commissions";
import { CommissionsContent } from "@/components/commissions/commissions-content";
import { redirect } from "next/navigation";

export default async function CommissionsPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // Obtener comisiones con totales
  const { commissions, totals } = await getCommissions();

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Comisiones</h1>
        <p className="text-muted-foreground">
          Resumen y detalle de comisiones generadas
        </p>
      </div>

      {/* Contenido interactivo */}
      <CommissionsContent
        commissions={commissions}
        totals={totals}
        userRole={session.user.role}
      />
    </div>
  );
}
