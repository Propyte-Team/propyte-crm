// Puerta propia de la conexión de revisión.
//
// Por qué NO se metió como pestaña de /admin: esa página es un server component que antes
// de renderizar carga getUsers(), getCommissionRules(), getApiKeys() y getWebhookConfigs(),
// y serializa todo al payload del cliente. Es el mismo motivo por el que las reglas de
// comentarios tienen su propia puerta. Aquí además hay una razón extra: esta pantalla
// PINTA UN SECRETO, así que cuanto menos cargue alrededor, mejor.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, KeyRound } from "lucide-react";
import { prisma } from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { datosDeConexion, puedeVerTokenRevision } from "@/lib/mcp/revision/conexion";
import { leerTokenEsperado } from "@/lib/mcp/revision/token";
import { PanelConexion } from "./PanelConexion";

// El token puede cambiar en cualquier momento desde esta misma pantalla: una versión
// cacheada mostraría el anterior y mandaría a pegar una URL que ya no abre.
export const dynamic = "force-dynamic";

export default async function ConectarRevisionPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // No es "esconder un botón": abajo se imprime una credencial en claro. El guardia de
  // verdad está además en la acción de servidor, que es un endpoint invocable sin pasar
  // por aquí.
  if (!puedeVerTokenRevision(session.user.role)) redirect("/dashboard");

  const { token, origen, rotadoEn } = await leerTokenEsperado(prisma);
  const host = headers().get("host") ?? "crm.propyte.com";
  const datos = datosDeConexion({
    host,
    token,
    origen,
    rotadoEn,
    githubPat: process.env.GITHUB_REVISION_PAT,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver
      </Link>

      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <KeyRound className="h-6 w-6 text-muted-foreground" />
          Conectar la revisión del CRM en Cowork
        </h1>
        <p className="mt-2 text-muted-foreground">
          Con esta URL, Cowork revisa el CRM todos los días —código, estado, fallos y
          oportunidades— y deja lo que encuentra en el tablero de mejoras. Solo lee: no
          puede cambiar nada del CRM.
        </p>
      </div>

      {!datos.githubListo && (
        // La puerta a medias dice CUÁL mitad le falta. Sin el PAT las tools de datos y
        // fallos funcionan igual, y decir "no está configurada" a secas mandaría a buscar
        // un problema que no existe.
        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">Falta GITHUB_REVISION_PAT.</p>
            <p className="mt-1">
              Las cuatro herramientas que leen el código del repositorio van a fallar
              nombrando esa variable. Las de estado, anomalías y fallos funcionan sin
              ella, así que la revisión diaria corre igual, solo que sin mirar el código.
            </p>
          </div>
        </div>
      )}

      <PanelConexion datos={datos} />

      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Después de conectar</p>
        <p className="mt-2">
          En Cowork, programa una tarea diaria con este texto:{" "}
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            Corre la revisión diaria del CRM siguiendo crm_revision_protocolo().
          </span>
        </p>
        <p className="mt-2">
          El protocolo vive en el servidor, así que se puede corregir sin tocar nada en
          claude.ai.
        </p>
      </div>
    </div>
  );
}
