// Página de aprobación de desarrollos para sync a Zoho CRM
// Permite cambiar zoho_pipeline_status en bulk
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { ZohoApprovalsClient } from "./zoho-approvals-client";

export default async function ZohoApprovalsPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  if (!["ADMIN", "DIRECTOR", "GERENTE"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  return <ZohoApprovalsClient />;
}
