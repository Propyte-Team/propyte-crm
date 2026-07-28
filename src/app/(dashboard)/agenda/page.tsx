// Agenda personal del asesor (spec §6, Fase 2) — componente de servidor.
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getMyAgenda, getMyRecentNotes } from "@/server/agenda";
import { AgendaView } from "@/components/agenda/agenda-view";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const [agenda, notes] = await Promise.all([getMyAgenda(), getMyRecentNotes()]);
  const firstName = (session.user.name ?? "").split(" ")[0] || "asesor";

  return (
    <AgendaView
      buckets={agenda.buckets}
      total={agenda.total}
      truncated={agenda.truncated}
      notes={notes}
      firstName={firstName}
    />
  );
}
