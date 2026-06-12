// Configuración personal del usuario (Anexo B §J.5)
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { SettingsView } from "@/components/settings/settings-view";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mi Configuración</h1>
        <p className="text-muted-foreground">Perfil, correo, tarjeta digital y plantillas</p>
      </div>
      <SettingsView />
    </div>
  );
}
