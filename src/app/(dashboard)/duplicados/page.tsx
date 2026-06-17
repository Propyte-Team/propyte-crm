import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { DuplicadosClient } from "@/components/contacts/duplicados-client";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER_EXT", "MANTENIMIENTO"];

export default async function DuplicadosPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  if (!FULL_ACCESS_ROLES.includes(session.user.role as string)) redirect("/dashboard");
  return <DuplicadosClient />;
}
