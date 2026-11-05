// Página: /copilot/plantillas (#988) — los textos de la cadencia de nuevos (del PDF de Luis).
import { redirect } from "next/navigation";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { puedeEditarPlantillas } from "@/lib/copilot/roles";
import { esTablaSinMigrar } from "@/lib/copilot/sin-migrar";
import { CopilotNav } from "@/components/copilot/copilot-nav";
import { EditorPlantillas } from "@/components/copilot/editor-plantillas";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Plantillas · Copilot | Propyte CRM",
};

export default async function PlantillasPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  let plantillas: Awaited<ReturnType<typeof prisma.copilotPlantilla.findMany>> = [];
  let sinMigrar = false;
  try {
    plantillas = await prisma.copilotPlantilla.findMany({ orderBy: [{ orden: "asc" }, { variante: "asc" }, { idioma: "desc" }] });
  } catch (err) {
    if (!esTablaSinMigrar(err)) throw err;
    sinMigrar = true;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <CopilotNav actual="plantillas" role={session.user.role} />
      <h1 className="mb-3 text-lg font-semibold text-[color:var(--text-primary)]">Plantillas de la cadencia de nuevos</h1>
      {sinMigrar ? (
        <div className="crm-card text-[13px] text-[color:var(--text-secondary)]">Falta correr la migración de «Mi día» (#988).</div>
      ) : (
        <EditorPlantillas
          plantillas={JSON.parse(JSON.stringify(plantillas))}
          editable={puedeEditarPlantillas(session.user.role)}
        />
      )}
    </div>
  );
}
