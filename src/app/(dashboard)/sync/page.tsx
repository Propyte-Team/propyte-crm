// Página de sincronización Drive/Dropbox → CRM
// Permite registrar carpetas, disparar syncs y ver logs
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { SyncDashboard } from "./sync-dashboard";

export default async function SyncPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // Solo ADMIN, DIRECTOR, GERENTE pueden acceder
  if (!["ADMIN", "DIRECTOR", "GERENTE"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  return <SyncDashboard />;
}
