// ============================================================
// Página: /copilot (#947) — módulo del asistente.
// Por ahora es solo el lugar en el menú: muestra un estado vacío.
// ============================================================
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getServerSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Copilot | Propyte CRM",
};

export default async function CopilotPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <Sparkles className="h-10 w-10 text-muted-foreground/60" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">Todavía no hay contenido</p>
    </div>
  );
}
