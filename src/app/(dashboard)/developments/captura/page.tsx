import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import CapturaClient from "./captura-client";

export default async function CapturaPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  if (!["DIRECTOR", "GERENTE", "ADMIN"].includes((session.user as { role?: string }).role ?? ""))
    redirect("/developments");
  return <CapturaClient />;
}
