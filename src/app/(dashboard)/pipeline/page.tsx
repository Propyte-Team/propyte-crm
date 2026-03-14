// Página del pipeline de ventas - componente de servidor
// Obtiene sesión, deals agrupados por etapa y renderiza vista principal
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getDealsByStage, getDeals } from "@/server/deals";
import { PipelineView } from "@/components/pipeline/pipeline-view";
import { formatCurrency } from "@/lib/constants";

export default async function PipelinePage() {
  // Verificar autenticación
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // Obtener deals agrupados por etapa para el kanban
  let dealsByStage: Record<string, any[]> = {};
  let totalDeals = 0;
  let valorPonderado = 0;

  try {
    dealsByStage = await getDealsByStage();

    // Calcular estadísticas de resumen
    for (const [stage, deals] of Object.entries(dealsByStage)) {
      totalDeals += deals.length;
      for (const deal of deals) {
        const probability = deal.probability || 0;
        const value = Number(deal.estimatedValue || 0);
        valorPonderado += (value * probability) / 100;
      }
    }
  } catch (error) {
    console.error("Error al cargar pipeline:", error);
  }

  return (
    <div className="space-y-6">
      {/* Encabezado con estadísticas */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline de Ventas</h1>
          <p className="text-muted-foreground">
            {totalDeals} deals activos &middot; {formatCurrency(valorPonderado)} valor ponderado
          </p>
        </div>
      </div>

      {/* Vista del pipeline con toggle Kanban/Tabla */}
      <PipelineView
        initialDealsByStage={dealsByStage}
        userRole={session.user.role}
        userId={session.user.id}
      />
    </div>
  );
}
