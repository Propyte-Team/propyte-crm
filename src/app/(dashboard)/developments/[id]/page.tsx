// Ficha del desarrollo — espejo de la página pública. Solo lectura.
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getPublishedDevelopment, listPublishedUnits } from "@/lib/hub/catalog";
import { DevelopmentDetailClient } from "./development-detail-client";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"];

export default async function DevelopmentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const { data: development, error: devError } = await getPublishedDevelopment(params.id);
  if (!devError && !development) notFound();

  const { data: units, error: unitsError } = development
    ? await listPublishedUnits({ developmentId: development.id })
    : { data: [], error: null };

  return (
    <DevelopmentDetailClient
      development={development}
      units={units}
      loadError={devError ?? unitsError}
      isAdmin={ADMIN_ROLES.includes(session.user.role)}
    />
  );
}
