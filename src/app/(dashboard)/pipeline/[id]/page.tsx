// Página de detalle de deal - componente de servidor
// Muestra información completa, barra de progreso de etapas,
// comisiones, timeline de actividades y acciones
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getDeal } from "@/server/deals";
import { DealDetailClient } from "./deal-detail-client";

interface DealDetailPageProps {
  params: { id: string };
}

export default async function DealDetailPage({ params }: DealDetailPageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const deal = await getDeal(params.id);
  if (!deal) notFound();

  return (
    <DealDetailClient
      deal={JSON.parse(JSON.stringify(deal))}
      userRole={session.user.role}
      userId={session.user.id}
    />
  );
}
