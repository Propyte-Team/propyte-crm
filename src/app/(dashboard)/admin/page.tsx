// Pagina de administracion: componente servidor con verificacion de rol
import { getServerSession } from "@/lib/auth/session";
import { getUsers, getCommissionRules, getSystemConfig, getWebhookConfigs, getApiKeys } from "@/server/admin";
import { redirect } from "next/navigation";
import { AdminContent } from "@/components/admin/admin-content";

export default async function AdminPage() {
  // Obtener sesion y verificar rol
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // Solo DIRECTOR y GERENTE pueden acceder
  if (!["DIRECTOR", "GERENTE"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  // Obtener datos en paralelo
  const [users, commissionRules, systemConfig, webhooks, apiKeys] = await Promise.all([
    getUsers(),
    getCommissionRules(),
    getSystemConfig(),
    getWebhookConfigs(),
    getApiKeys(),
  ]);

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Administracion</h1>
        <p className="text-muted-foreground">
          Gestiona usuarios, comisiones y configuracion del sistema
        </p>
      </div>

      {/* Contenido con pestanas (componente cliente) */}
      <AdminContent
        initialUsers={users}
        initialCommissionRules={commissionRules}
        initialSystemConfig={systemConfig}
        initialWebhooks={webhooks}
        initialApiKeys={apiKeys}
      />
    </div>
  );
}
