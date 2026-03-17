// Página del catálogo de desarrollos inmobiliarios - componente de servidor
// Obtiene datos reales de la BD y muestra grid de tarjetas con filtros
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { getDevelopments } from "@/server/developments";
import { DevelopmentsClient } from "./developments-client";

export default async function DevelopmentsPage() {
  // Verificar autenticación
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // Obtener desarrollos de la BD
  let developments: any[] = [];
  try {
    developments = await getDevelopments();
  } catch (error) {
    console.error("Error al cargar desarrollos:", error);
  }

  // Determinar si el usuario puede crear/editar desarrollos
  const isAdmin = ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"].includes(
    session.user.role
  );

  return (
    <DevelopmentsClient
      initialDevelopments={JSON.parse(JSON.stringify(developments))}
      isAdmin={isAdmin}
      userRole={session.user.role}
    />
  );
}
