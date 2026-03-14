// Pagina de reportes: componente servidor con grid de tarjetas
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { ReportsGrid } from "@/components/reports/reports-grid";

export default async function ReportsPage() {
  // Verificar sesion
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
        <p className="text-muted-foreground">
          Genera reportes detallados de tu operacion comercial
        </p>
      </div>

      {/* Grid de reportes (componente cliente) */}
      <ReportsGrid />
    </div>
  );
}
