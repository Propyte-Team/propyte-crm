// «Marcas que ve» un usuario (2026-10-12, spec marcas-visibilidad, entrega 2 de 3).
// PUT { brandIds } reemplaza el conjunto COMPLETO del usuario, incluida la predeterminada si queda
// prendida: una vez que un admin lo edita, el conjunto es explícito y "sin filas" (= solo la
// predeterminada) deja de aplicar.
//
// Solo ADMIN, a propósito. DIRECTOR y GERENTE entran a /admin, pero ellos mismos están sujetos a
// sus interruptores (decisión 2): si pudieran editarlos, podrían prenderse cualquier marca.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { seesAllBrands } from "@/lib/brands/visibility";
import { isMissingTable } from "@/lib/brands/admin";
import { userBrandAccessSchema } from "@/lib/validations/user-brand-access";

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession();
  // Mismo rol que ve todas las marcas: quien decide qué ve cada quien es quien no está filtrado.
  if (!session?.user || !seesAllBrands(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const parsed = userBrandAccessSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { brandIds } = parsed.data;

  try {
    const target = await prisma.user.findFirst({
      where: { id: params.id, deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

    // Solo marcas vivas: prender una marca borrada no tendría efecto (visibility.ts las ignora) y
    // dejaría al admin creyendo que el usuario la ve.
    const vivas = await prisma.brand.findMany({
      where: { id: { in: brandIds }, deletedAt: null },
      select: { id: true },
    });
    if (vivas.length !== brandIds.length) {
      return NextResponse.json({ error: "Marca no encontrada o eliminada" }, { status: 400 });
    }

    const previas = await prisma.userBrandAccess.findMany({
      where: { userId: target.id },
      select: { brandId: true },
    });

    // Reemplazo atómico: si el alta fallara a medias, el usuario no debe quedarse "sin filas"
    // (que se leería como "solo la predeterminada") por un error de red.
    await prisma.$transaction([
      prisma.userBrandAccess.deleteMany({ where: { userId: target.id } }),
      prisma.userBrandAccess.createMany({
        data: brandIds.map((brandId) => ({ userId: target.id, brandId })),
      }),
    ]);

    // Rastro best-effort, mismo shape que los cambios de usuario de @/server/admin. `from: null`
    // = el usuario no tenía filas (veía solo la predeterminada). getUserAuditHistory solo lista
    // los cambios de isActive, así que esto no ensucia el historial de altas y bajas.
    await prisma.auditLog
      .create({
        data: {
          userId: session.user.id,
          action: "UPDATE",
          entity: "User",
          entityId: target.id,
          changes: {
            field: "brandAccess",
            from: previas.length > 0 ? previas.map((p) => p.brandId) : null,
            to: brandIds,
            targetName: target.name,
            targetEmail: target.email,
          },
        },
      })
      .catch(() => {});

    return NextResponse.json({ data: { userId: target.id, brandIds } });
  } catch (err) {
    if (isMissingTable(err)) {
      return NextResponse.json(
        { error: "Falta aplicar la migración de marcas por usuario (2026-10-12-user-brand-access.sql)" },
        { status: 503 }
      );
    }
    console.error("[brands] PUT marcas del usuario:", err);
    return NextResponse.json({ error: "No se pudieron guardar las marcas" }, { status: 500 });
  }
}
