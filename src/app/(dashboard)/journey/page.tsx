import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { JourneyView } from "@/components/journey/journey-view";

export const dynamic = "force-dynamic";

// El Journey lo ven administración, dirección y gerencia (el gerente, solo su plaza).
const ALLOWED = ["ADMIN", "DIRECTOR", "GERENTE"];

export default async function JourneyPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  if (!ALLOWED.includes(session.user.role)) redirect("/hoy");
  return <JourneyView conMapa={session.user.role !== "GERENTE"} />;
}
