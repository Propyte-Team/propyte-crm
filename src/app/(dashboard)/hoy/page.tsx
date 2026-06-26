// Vista Hoy del asesor (Fase 2, T2.1) — componente de servidor.
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getTodayView } from "@/server/today";
import { TodayView } from "@/components/today/today-view";

export const dynamic = "force-dynamic";

export default async function HoyPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const data = await getTodayView(session.user.id, session.user.role);
  const firstName = (session.user.name ?? "").split(" ")[0] || "asesor";

  return <TodayView data={JSON.parse(JSON.stringify(data))} firstName={firstName} userId={session.user.id} />;
}
