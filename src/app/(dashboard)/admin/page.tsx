// Pagina de administracion: componente servidor con verificacion de rol
import { getServerSession } from "@/lib/auth/session";
import { getUsers, getCommissionRules, getSystemConfig, getWebhookConfigs, getApiKeys } from "@/server/admin";
import { getBotConfigForAdmin } from "@/server/bot-config";
import { listPlaybooks } from "@/server/bot-playbook";
import { listAgentProfiles } from "@/server/bot-agents";
import prisma from "@/lib/db";
import { redirect } from "next/navigation";
import { AdminContent } from "@/components/admin/admin-content";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  // Obtener sesion y verificar rol
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // Solo ADMIN, DIRECTOR y GERENTE pueden acceder
  if (!["ADMIN", "DIRECTOR", "GERENTE"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  // Custom fields del objeto "contact" disponibles como targetField del bot
  // (best-effort: si el objeto o la tabla aun no existen, no bloquea el admin).
  const contactCustomFields = await prisma.customFieldDef
    .findMany({
      where: { isActive: true, objectApiName: "contact" },
      select: { apiName: true },
      orderBy: { order: "asc" },
    })
    .then((defs) => defs.map((d) => `custom.${d.apiName}`))
    .catch(() => [] as string[]);

  // Obtener datos en paralelo
  const [users, commissionRules, systemConfig, webhooks, apiKeys, botConfig, playbooks, agentProfiles] = await Promise.all([
    getUsers(),
    getCommissionRules(),
    getSystemConfig(),
    getWebhookConfigs(),
    getApiKeys(),
    getBotConfigForAdmin(),
    listPlaybooks(),
    // best-effort pre-migración: la pestaña Agentes muestra vacío en vez de romper /admin
    listAgentProfiles().catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      {/* Contenido: vista de detalle del hub de Configuración */}
      <AdminContent
        initialTab={searchParams?.tab}
        initialUsers={users}
        initialCommissionRules={commissionRules}
        initialSystemConfig={systemConfig}
        initialWebhooks={webhooks}
        initialApiKeys={apiKeys}
        botConfig={botConfig}
        playbooks={playbooks}
        agentProfiles={agentProfiles.map((a) => ({
          id: a.id, name: a.name, contactTypes: a.contactTypes as string[], identity: a.identity,
          playbookId: a.playbookId, tonePreset: a.tonePreset, isActive: a.isActive, priority: a.priority,
        }))}
        activePlaybookId={botConfig.activePlaybookId}
        contactCustomFields={contactCustomFields}
      />
    </div>
  );
}
