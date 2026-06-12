// Inbox WhatsApp — bot con takeover humano (Anexo B §I.6)
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { InboxView } from "@/components/inbox/inbox-view";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  return <InboxView userId={session.user.id} userRole={session.user.role} />;
}
