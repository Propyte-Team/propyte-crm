// Espejo del catálogo publicado en propyte.com — server component.
// El CRM no posee inventario: esta pantalla solo refleja real_estate_hub.v_developments
// con el gate público. La edición vive en el Hub.
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { listPublishedDevelopments } from "@/lib/hub/catalog";
import { DevelopmentsClient } from "./developments-client";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"];

export default async function DevelopmentsPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const { data: developments, error } = await listPublishedDevelopments();

  return (
    <DevelopmentsClient
      developments={developments}
      loadError={error}
      isAdmin={ADMIN_ROLES.includes(session.user.role)}
    />
  );
}
