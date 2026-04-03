// Página de monitoreo del sync Supabase ↔ Zoho CRM
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { ZohoSyncDashboard } from "./zoho-sync-dashboard";

export default async function ZohoSyncPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  if (!["ADMIN", "DIRECTOR", "GERENTE"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  return <ZohoSyncDashboard />;
}
