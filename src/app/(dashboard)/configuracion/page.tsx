// Centro de Configuración — índice estilo Zoho Settings (pedido Luis 2026-06-11):
// TODO lo configurable del CRM visible y editable desde un solo lugar.
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { ConfigCenter } from "@/components/config/config-center";

export const dynamic = "force-dynamic";

const ALLOWED = ["ADMIN", "DIRECTOR", "GERENTE"];

export default async function ConfiguracionPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  if (!ALLOWED.includes(session.user.role)) redirect("/dashboard");

  return <ConfigCenter userRole={session.user.role} />;
}
