// Página de detalle de desarrollo en el portal externo
// Server component que obtiene datos y renderiza el detalle
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getPortalDevelopmentDetail } from "@/server/portal";
import { PortalDevelopmentDetail } from "@/components/portal/portal-development-detail";

interface Props {
  params: { id: string };
}

export default async function PortalDevelopmentPage({ params }: Props) {
  // Verificar sesión y rol
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "DEVELOPER_EXT") {
    redirect("/dashboard");
  }

  // Obtener detalle del desarrollo (sin datos de contacto)
  const detail = await getPortalDevelopmentDetail(params.id, session.user.id);

  // Serializar datos de Prisma (Decimal → number, Date → string) para el client component
  const serialized = JSON.parse(JSON.stringify(detail, (_key, value) =>
    typeof value === "object" && value !== null && "toNumber" in value
      ? value.toNumber()
      : value
  ));

  return <PortalDevelopmentDetail data={serialized} />;
}
