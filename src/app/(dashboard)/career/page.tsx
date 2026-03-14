// Página de plan de carrera: componente servidor que obtiene datos reales
import { getServerSession } from "@/lib/auth/session";
import { getCareerProgress, getCareerKPIs } from "@/server/career";
import { redirect } from "next/navigation";
import { CareerContent } from "@/components/career/career-content";

export default async function CareerPage() {
  // Obtener sesión del usuario
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const userId = session.user.id;

  // Obtener datos de carrera en paralelo
  const [progress, kpis] = await Promise.all([
    getCareerProgress(userId),
    getCareerKPIs(userId),
  ]);

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mi Plan de Carrera</h1>
        <p className="text-muted-foreground">
          Consulta tu progreso y los requisitos para avanzar al siguiente nivel
        </p>
      </div>

      {/* Contenido del plan de carrera (componente cliente) */}
      <CareerContent progress={progress} kpis={kpis} />
    </div>
  );
}
