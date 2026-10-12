// Inbox WhatsApp — bot con takeover humano (Anexo B §I.6)
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { InboxView } from "@/components/inbox/inbox-view";
import { BrandViewProvider } from "@/components/brands/brand-view";
import { getBrandViewContext } from "@/lib/brands/view-context";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // Marcas (entrega 3, 2026-10-12): opciones del selector «Marca» y nombres para el badge del hilo.
  const brandView = await getBrandViewContext(session.user);

  return (
    <BrandViewProvider value={brandView}>
      <InboxView userId={session.user.id} userRole={session.user.role} />
    </BrandViewProvider>
  );
}
