// ============================================================
// Página: /empresas (#949; antes /desarrolladores, #872) — desarrolladoras, inmobiliarias,
// proveedores y demás aliados. Clic en una empresa → cuadro con sus contactos.
// ============================================================

import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";
import { esTablaFaltante, puedeEditarDesarrolladores, type DesarrolladorFila } from "@/lib/developer-partners/shared";
import { DesarrolladoresClient } from "@/components/developer-partners/desarrolladores-client";

export const metadata = {
  title: "Empresas | Propyte CRM",
};

async function cargar(): Promise<DesarrolladorFila[]> {
  try {
    return await prisma.developerPartner.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, type: true, website: true, email: true, phone: true },
      orderBy: { name: "asc" },
    });
  } catch (err) {
    // Desplegado antes que la migración: tabla vacía en vez de pantalla de error.
    if (esTablaFaltante(err)) return [];
    throw err;
  }
}

export default async function EmpresasPage(props: { searchParams: Promise<{ empresa?: string | string[] }> }) {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const [empresas, sp] = await Promise.all([cargar(), props.searchParams]);
  // ?empresa=<id>: la liga desde la ficha del contacto abre el cuadro de esa empresa.
  const abrirId = typeof sp.empresa === "string" ? sp.empresa : null;

  return (
    <DesarrolladoresClient
      initial={empresas}
      canEdit={puedeEditarDesarrolladores(session.user.role)}
      abrirId={abrirId}
    />
  );
}
