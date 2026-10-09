// Listar y crear marcas del agente (2026-10-09, spec marcas-agente). Lectura: mismos roles que
// /conexiones (incluye MARKETING, que asigna cuentas a marcas). Escritura: roles de la config del
// bot. `isDefault` nunca viene del cliente: la marca predeterminada la siembra la migración.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { canReadBrands, canWriteBrands } from "@/lib/brands/roles";
import { brandRefsError, brandWriteData, isMissingTable, isUniqueClash } from "@/lib/brands/admin";
import { brandCreateSchema } from "@/lib/validations/brand";

async function assertRole(check: (role: string | null | undefined) => boolean) {
  const session = await getServerSession();
  if (!session?.user || !check(session.user.role)) return null;
  return session;
}

export async function GET() {
  const session = await assertRole(canReadBrands);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  try {
    const brands = await prisma.brand.findMany({
      where: { deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      include: {
        connectors: {
          where: { deletedAt: null },
          select: { id: true, name: true, provider: true, status: true },
        },
      },
    });
    return NextResponse.json({ data: brands });
  } catch (err) {
    if (isMissingTable(err)) return NextResponse.json({ data: [] });
    console.error("[brands] GET:", err);
    return NextResponse.json({ error: "Error al listar marcas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await assertRole(canWriteBrands);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = brandCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const refsError = await brandRefsError(parsed.data);
  if (refsError) return NextResponse.json({ error: refsError }, { status: 400 });

  let brand;
  try {
    brand = await prisma.brand.create({
      data: {
        ...brandWriteData(parsed.data),
        name: parsed.data.name,
        slug: parsed.data.slug,
        isDefault: false, // jamás del cliente: solo existe la fila sembrada por la migración
      },
    });
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
        action: "CREATE",
        entity: "Brand",
        entityId: brand.id,
        // Sin persona/knowledge: son textos largos que no hacen falta para la traza.
        changes: { name: brand.name, slug: brand.slug },
      },
    })
    .catch(() => {});

  return NextResponse.json({ data: brand }, { status: 201 });
}
