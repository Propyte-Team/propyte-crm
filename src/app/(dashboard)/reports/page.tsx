// Pagina de reportes: componente servidor con grid de tarjetas
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { ReportsGrid } from "@/components/reports/reports-grid";
import { puedeVerReportes } from "@/lib/rbac/report-scope";

export default async function ReportsPage() {
  // Verificar sesion
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  // #893: los mismos roles que ven «Reportes» en el menú. Antes bastaba con tener sesión y un
  // asesor que escribía /reports veía las cifras de toda la empresa. Mismo destino que usa el
  // middleware para las demás rutas restringidas.
  if (!puedeVerReportes(session.user.role)) redirect("/hoy");

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
        <p className="text-muted-foreground">
          Genera reportes detallados de tu operación comercial
        </p>
      </div>

      {/* Grid de reportes (componente cliente) */}
      <ReportsGrid />
    </div>
  );
}
