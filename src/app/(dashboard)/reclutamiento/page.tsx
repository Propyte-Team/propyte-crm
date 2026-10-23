// ============================================================
// Página: /reclutamiento (#926) — Desempeño · personas en proceso de contratación
// ============================================================
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { listarCandidatos } from "@/server/reclutamiento";
import { esTablaFaltante, type CandidatoFila } from "@/lib/reclutamiento/shared";
import { puedeEliminarEnReclutamiento, puedeVerReclutamiento } from "@/lib/reclutamiento/roles";
import { ReclutamientoClient } from "@/components/reclutamiento/reclutamiento-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reclutamiento | Propyte CRM",
};

async function cargar(): Promise<{ filas: CandidatoFila[]; sinMigracion: boolean }> {
  try {
    return { filas: await listarCandidatos(), sinMigracion: false };
  } catch (err) {
    // Desplegado antes que la migración: tabla vacía con aviso, no pantalla de error.
    if (esTablaFaltante(err)) return { filas: [], sinMigracion: true };
    throw err;
  }
}

export default async function ReclutamientoPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  // Datos personales (LFPDPPP): mismos roles que ven «Reclutamiento» en el menú.
  if (!puedeVerReclutamiento(session.user.role)) redirect("/hoy");

  const { filas, sinMigracion } = await cargar();
  return (
    <ReclutamientoClient
      initial={filas}
      sinMigracion={sinMigracion}
      puedeEliminar={puedeEliminarEnReclutamiento(session.user.role)}
    />
  );
}
