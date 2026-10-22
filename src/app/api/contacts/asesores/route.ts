// ============================================================
// API Route: /api/contacts/asesores (#919)
// GET - Opciones del filtro «Asesores» de la lista de Contactos.
//
// Devuelve a los DUEÑOS de los contactos que quien consulta puede ver, con cuántos tiene cada
// uno, y cuántos de esos contactos no tienen dueño. No es la lista de usuarios con rol de
// asesor: un dueño puede ser un ADMIN (Felipe tiene los 562 contactos migrados de Zoho), y un
// asesor sin contactos visibles no sirve como filtro.
//
// El alcance es el MISMO que el de la lista (lib/contacts/alcance-lista.ts) más la visibilidad
// de marca, así que nadie ve aquí a un asesor cuyos contactos no puede ver: un gerente ve a
// los de su plaza, un líder a su equipo y un asesor solo a sí mismo.
// ============================================================

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { sumarAlAnd } from "@/lib/api/where-and";
import { getVisibleBrands } from "@/lib/brands/user-access";
import { contactBrandVisibilityWhere } from "@/lib/brands/visibility";
import { alcanceListaContactos } from "@/lib/contacts/alcance-lista";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const alcance = await alcanceListaContactos(session.user);
    if (!alcance) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }
    const where: Prisma.ContactWhereInput = { deletedAt: null, ...alcance };
    const porMarca = contactBrandVisibilityWhere(session.user, await getVisibleBrands(session.user));
    if (porMarca) sumarAlAnd(where, porMarca);

    const grupos = await prisma.contact.groupBy({
      by: ["assignedToId"],
      where,
      _count: { _all: true },
    });

    const ids = grupos.map((g) => g.assignedToId).filter((id): id is string => !!id);
    const usuarios = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isActive: true } })
      : [];
    const porId = new Map(usuarios.map((u) => [u.id, u]));

    const asesores = grupos
      .filter((g) => g.assignedToId && porId.has(g.assignedToId))
      .map((g) => {
        const u = porId.get(g.assignedToId as string)!;
        return { id: u.id, name: u.name, isActive: u.isActive, total: g._count._all };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    const sinAsignar = grupos.find((g) => g.assignedToId === null)?._count._all ?? 0;

    return NextResponse.json({ data: asesores, sinAsignar });
  } catch (error) {
    console.error("Error en /api/contacts/asesores:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
