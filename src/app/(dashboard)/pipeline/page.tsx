// Página del pipeline de ventas - componente de servidor
// Obtiene sesión, deals agrupados por etapa y renderiza vista principal
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getDealsByStage } from "@/server/deals";
import { PipelineView } from "@/components/pipeline/pipeline-view";

export default async function PipelinePage() {
  // Verificar autenticación
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // Obtener deals agrupados por etapa para el kanban
  let dealsByStage: Record<string, any[]> = {};

  try {
    dealsByStage = await getDealsByStage();
  } catch (error) {
    console.error("Error al cargar pipeline:", error);
  }

  return (
    <div className="space-y-6">
      {/* El encabezado vive en PipelineView para que las estadísticas se actualicen en vivo */}
      {/* Vista del pipeline con toggle Kanban/Tabla */}
      <PipelineView
        initialDealsByStage={dealsByStage}
        userRole={session.user.role}
        userId={session.user.id}
      />
    </div>
  );
}
