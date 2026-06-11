// Perfil del usuario en sesión (Anexo B §J.1). ADMIN puede operar otro con ?userId=.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { userProfileSchema } from "@/lib/validations/rebuild-f1";
import { normalizePhoneE164 } from "@/lib/phone";

const ADMIN_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];

async function resolveTargetUserId(req: NextRequest): Promise<{ userId: string; sessionUserId: string } | null> {
  const session = await getServerSession();
  if (!session?.user) return null;
  const requested = req.nextUrl.searchParams.get("userId");
  if (requested && requested !== session.user.id) {
    if (!ADMIN_ROLES.includes(session.user.role)) return null;
    return { userId: requested, sessionUserId: session.user.id };
  }
  return { userId: session.user.id, sessionUserId: session.user.id };
}

export async function GET(req: NextRequest) {
  const target = await resolveTargetUserId(req);
  if (!target) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const profile = await prisma.userProfile.findUnique({
    where: { userId: target.userId },
    include: { user: { select: { id: true, name: true, email: true, role: true, plaza: true } } },
  });

  if (profile) return NextResponse.json({ data: profile });

  // Sin perfil aún: devolver esqueleto con datos del user
  const user = await prisma.user.findUnique({
    where: { id: target.userId },
    select: { id: true, name: true, email: true, role: true, plaza: true },
  });
  return NextResponse.json({ data: { userId: target.userId, user, isNew: true } });
}

export async function PATCH(req: NextRequest) {
  const target = await resolveTargetUserId(req);
  if (!target) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = userProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = { ...parsed.data };

  // Normalizar teléfonos
  if (data.phoneDirect) data.phoneDirect = normalizePhoneE164(data.phoneDirect) ?? data.phoneDirect;
  if (data.whatsappNumber) data.whatsappNumber = normalizePhoneE164(data.whatsappNumber) ?? data.whatsappNumber;

  // cardSlug inmutable tras publicar (§J.6: los QR impresos no se rompen)
  const existing = await prisma.userProfile.findUnique({ where: { userId: target.userId } });
  if (existing?.cardSlug && data.cardSlug && data.cardSlug !== existing.cardSlug) {
    return NextResponse.json(
      { error: "El slug de la tarjeta es inmutable una vez publicado (los QR impresos dejarían de funcionar)" },
      { status: 422 }
    );
  }

  const profile = await prisma.userProfile.upsert({
    where: { userId: target.userId },
    update: data as never,
    create: { userId: target.userId, ...(data as object) } as never,
  });

  return NextResponse.json({ data: profile });
}
