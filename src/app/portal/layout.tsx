// Layout independiente del portal de desarrollador externo
// NO usa el layout del dashboard principal (sin sidebar)
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { PortalHeader } from "@/components/portal/portal-header";

export const metadata = {
  title: "Portal de Desarrollador | PROPYTE",
  description: "Portal externo para desarrolladores inmobiliarios",
};

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Verificar autenticación y rol DEVELOPER_EXT
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "DEVELOPER_EXT") {
    // Usuarios con otro rol no pueden acceder al portal
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header del portal con logo y datos de usuario */}
      <PortalHeader userName={session.user.name} />

      {/* Contenido principal */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
