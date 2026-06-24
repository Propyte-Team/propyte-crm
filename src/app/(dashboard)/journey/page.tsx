import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { JourneyMapView } from "@/components/journey/journey-map-view";

export const dynamic = "force-dynamic";

const ALLOWED = ["ADMIN", "DIRECTOR"];

export default async function JourneyPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  if (!ALLOWED.includes(session.user.role)) redirect("/dashboard");
  return <JourneyMapView />;
}
