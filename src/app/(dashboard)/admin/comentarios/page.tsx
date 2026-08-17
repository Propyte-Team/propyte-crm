// Puerta propia de las reglas de comentarios sociales.
//
// Por qué existe si /admin?tab=comments ya la renderiza: /admin es un server
// component que ANTES de renderizar carga getUsers(), getCommissionRules(),
// getApiKeys(), getWebhookConfigs()… — todas exigen rol de administración y
// todas serializan su resultado al payload del cliente. Abrirle esa página a
// MARKETING haría dos daños: reventaría con "Acceso denegado" en la primera
// llamada, y si se hicieran permisivas le mandaría al navegador los usuarios,
// las comisiones y los metadatos de las API keys.
//
// CommentRulesTab no recibe props (se sirve sola por fetch contra
// /api/admin/comment-rules y /api/admin/connectors, ambas con su propio guard),
// así que esta página no precarga NADA: no hay nada que filtrar.
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import Link from "next/link";
import { canManageCommentRules } from "@/lib/comments/roles";
import { CommentRulesTab } from "@/components/admin/comments/comment-rules-tab";

export default async function AdminComentariosPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // El guard real de los datos vive en las rutas /api/*; esto solo evita
  // renderizar una pantalla que de todas formas no cargaría.
  if (!canManageCommentRules(session.user.role)) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Comentarios</h1>
      </div>

      <CommentRulesTab />
    </div>
  );
}
