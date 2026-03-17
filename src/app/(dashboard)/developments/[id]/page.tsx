// Página de detalle de desarrollo - componente de servidor
// Muestra info completa, mapa de unidades y estadísticas
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getDevelopment } from "@/server/developments";
import { DevelopmentDetailClient } from "./development-detail-client";

interface DevelopmentDetailPageProps {
  params: { id: string };
}

export default async function DevelopmentDetailPage({
  params,
}: DevelopmentDetailPageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const development = await getDevelopment(params.id);
  if (!development) notFound();

  const isAdmin = ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"].includes(
    session.user.role
  );

  return (
    <DevelopmentDetailClient
      development={JSON.parse(JSON.stringify(development))}
      isAdmin={isAdmin}
    />
  );
}
