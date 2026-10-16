import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { MetasClient } from "@/components/goals/metas-client";
import { nivelMetas, puedeFijarMetas, puedeFijarMetasEmpresa } from "@/lib/rbac/goal-scope";

export const dynamic = "force-dynamic";

export default async function MetasPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  const role = session.user.role as string;
  const user = { id: session.user.id, role, plaza: session.user.plaza };
  // #895: la pantalla solo decide qué botones se ven. Quién ve y fija qué lo decide el servidor
  // (lib/rbac/goal-scope.ts), así que un botón de más no abre nada.
  return (
    <MetasClient
      canEdit={puedeFijarMetas(role)}
      canEditCompany={puedeFijarMetasEmpresa(role)}
      selfUser={{ id: session.user.id, name: session.user.name ?? null, email: session.user.email ?? null }}
      // El gerente elige entre la gente de su plaza; el líder ya recibe solo a su equipo.
      advisorPlaza={nivelMetas(user) === "PLAZA" ? (session.user.plaza as string) : null}
    />
  );
}
