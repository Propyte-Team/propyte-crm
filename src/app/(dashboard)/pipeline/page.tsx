// Página del pipeline de ventas - componente de servidor
// Obtiene sesión, deals agrupados por etapa y renderiza vista principal
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getDealsByStage } from "@/server/deals";
import { PipelineView } from "@/components/pipeline/pipeline-view";
import { BrandViewProvider } from "@/components/brands/brand-view";
import { getBrandViewContext } from "@/lib/brands/view-context";
import { BRAND_FILTER_PARAM } from "@/lib/brands/filter";

export default async function PipelinePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  // Verificar autenticación
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // Selector «Marca» (entrega 3, 2026-10-12): el tablero ya sale filtrado por el `?marca=` de la
  // URL. getDealsByStage ignora una marca que el usuario no ve.
  const marca = searchParams[BRAND_FILTER_PARAM];
  const brandId = typeof marca === "string" ? marca : undefined;
  const brandView = await getBrandViewContext(session.user);

  // Obtener deals agrupados por etapa para el kanban
  let dealsByStage: Record<string, any[]> = {};

  try {
    dealsByStage = await getDealsByStage({ brandId });
  } catch (error) {
    console.error("Error al cargar pipeline:", error);
  }

  return (
    <div className="space-y-6">
      {/* El encabezado vive en PipelineView para que las estadísticas se actualicen en vivo */}
      {/* Vista del pipeline con toggle Kanban/Tabla */}
      <BrandViewProvider value={brandView}>
        <PipelineView
          initialDealsByStage={dealsByStage}
          userRole={session.user.role}
          userId={session.user.id}
        />
      </BrandViewProvider>
    </div>
  );
}
