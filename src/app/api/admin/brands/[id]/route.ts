// Editar y borrar (soft) una marca del agente (2026-10-09, spec marcas-agente). Solo roles de la
// config del bot. La marca predeterminada usa la configuración GLOBAL del bot: solo se renombra y
// nunca se borra, para que "sin marca" siga comportándose exactamente igual que antes.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { canWriteBrands } from "@/lib/brands/roles";
import { brandRefsError, brandWriteData, isUniqueClash } from "@/lib/brands/admin";
import { brandPatchSchema } from "@/lib/validations/brand";

async function assertRole() {
  const session = await getServerSession();
  if (!session?.user || !canWriteBrands(session.user.role)) return null;
  return session;
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await assertRole();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = brandPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const current = await prisma.brand.findFirst({
    where: { id: params.id, deletedAt: null },
    // playbookId y marketingOwnerUserId: para no revalidar lo que el formulario reenvía sin cambios.
    select: { id: true, isDefault: true, playbookId: true, marketingOwnerUserId: true },
  });
  if (!current) return NextResponse.json({ error: "Marca no encontrada" }, { status: 404 });

  // La predeterminada no tiene persona/canales/agente propios: lee la config global. Dejar que se
  // edite aquí crearía una configuración que nada usa y que parecería activa.
  if (current.isDefault && Object.keys(parsed.data).some((k) => k !== "name")) {
    return NextResponse.json(
      {
        error:
          "La marca predeterminada usa la configuración global del bot; solo se puede renombrar",
      },
      { status: 400 }
    );
  }

  // El formulario reenvía siempre playbookId y marketingOwnerUserId: si siguen siendo los que la
  // marca ya tenía, una referencia vieja (playbook borrado, responsable dado de baja) no bloquea el
  // guardado. Solo se valida lo que cambia (2026-10-09).
  const refsError = await brandRefsError(parsed.data, {
    playbookId: current.playbookId,
    marketingOwnerUserId: current.marketingOwnerUserId,
  });
  if (refsError) return NextResponse.json({ error: refsError }, { status: 400 });

  const data = brandWriteData(parsed.data);

  let brand;
  try {
    brand = await prisma.brand.update({ where: { id: current.id }, data });
  } catch (err) {
    if (isUniqueClash(err)) {
      return NextResponse.json(
        { error: "Ya existe una marca con ese nombre o ese slug, aunque esté eliminada" },
        { status: 409 }
      );
    }
    throw err;
  }

  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: "UPDATE",
        entity: "Brand",
        entityId: brand.id,
        // Solo los nombres de campos: persona/knowledge son textos largos.
        changes: { fields: Object.keys(data) },
      },
    })
    .catch(() => {});

  return NextResponse.json({ data: brand });
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await assertRole();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const current = await prisma.brand.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { id: true, isDefault: true },
  });
  if (!current) return NextResponse.json({ error: "Marca no encontrada" }, { status: 404 });

  if (current.isDefault) {
    return NextResponse.json(
      { error: "La marca predeterminada no se puede eliminar" },
      { status: 400 }
    );
  }

  // Una cuenta activa de una marca borrada dejaría de resolver su agente. Hay que reasignarla o
  // pausarla primero; las pausadas no bloquean.
  const activeConnectors = await prisma.leadConnector.count({
    where: { brandId: current.id, status: "ACTIVE", deletedAt: null },
  });
  if (activeConnectors > 0) {
    return NextResponse.json(
      {
        error: `La marca tiene ${activeConnectors} cuenta(s) activa(s); reasígnalas o páusalas antes de eliminarla`,
      },
      { status: 409 }
    );
  }

  await prisma.brand.update({
    where: { id: current.id },
    data: { deletedAt: new Date(), botEnabled: false },
  });

  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: "DELETE",
        entity: "Brand",
        entityId: current.id,
      },
    })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
