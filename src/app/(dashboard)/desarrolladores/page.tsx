// ============================================================
// Página: /desarrolladores (#872) — empresas inmobiliarias y otros aliados
// ============================================================

import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";
import { esTablaFaltante, puedeEditarDesarrolladores, type DesarrolladorFila } from "@/lib/developer-partners/shared";
import { DesarrolladoresClient } from "@/components/developer-partners/desarrolladores-client";

export const metadata = {
  title: "Desarrolladores | Propyte CRM",
};

async function cargar(): Promise<DesarrolladorFila[]> {
  try {
    return await prisma.developerPartner.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, website: true, email: true, phone: true },
      orderBy: { name: "asc" },
    });
  } catch (err) {
    // Desplegado antes que la migración: tabla vacía en vez de pantalla de error.
    if (esTablaFaltante(err)) return [];
    throw err;
  }
}

export default async function DesarrolladoresPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const desarrolladores = await cargar();

  return (
    <DesarrolladoresClient
      initial={desarrolladores}
      canEdit={puedeEditarDesarrolladores(session.user.role)}
    />
  );
}
