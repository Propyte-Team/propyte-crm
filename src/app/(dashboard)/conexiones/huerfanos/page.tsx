// Leads huérfanos (2026-10-12, entrega 3 de marcas, decisión 3): mismos roles que Conexiones.
// Vive junto a Conexiones porque el caso más grave —mensajes que llegaron a una cuenta sin
// registrar— se arregla dando de alta la cuenta ahí.
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { canSeeOrphanLeads } from "@/lib/leads/orphans";
import { getOrphanLeads } from "@/server/orphan-leads";
import { getBrandViewContext } from "@/lib/brands/view-context";
import { BrandViewProvider } from "@/components/brands/brand-view";
import { OrphanLeadsView } from "@/components/conexiones/orphan-leads-view";

export const dynamic = "force-dynamic";

export default async function LeadsHuerfanosPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  if (!canSeeOrphanLeads(session.user.role)) redirect("/dashboard");

  const [data, brandView] = await Promise.all([
    getOrphanLeads(session.user, { limit: 50 }),
    getBrandViewContext(session.user),
  ]);
  if (!data) redirect("/dashboard");

  return (
    <BrandViewProvider value={brandView}>
      <OrphanLeadsView
        data={data}
        currentUser={{ id: session.user.id, name: session.user.name ?? session.user.email ?? null }}
      />
    </BrandViewProvider>
  );
}
