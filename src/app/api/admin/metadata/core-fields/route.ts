// Permisos de campo CORE por rol (Fase B). GET catálogo + permisos · PUT upsert de una celda.
// Solo ADMIN edita (PC2). Default sin fila = EDIT.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { CORE_FIELDS, coreFieldKeys } from "@/lib/metadata/core-fields";

const ROLES = [
  "ADMIN", "ASESOR", "BROKER", "MANTENIMIENTO", "DIRECTOR", "GERENTE",
  "TEAM_LEADER", "ASESOR_SR", "ASESOR_JR", "HOSTESS", "MARKETING", "DEVELOPER_EXT",
] as const;

const putSchema = z.object({
  object: z.string().min(2),
  fieldKey: z.string().min(1),
  role: z.enum(ROLES),
  access: z.enum(["HIDDEN", "READ", "EDIT"]),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const object = req.nextUrl.searchParams.get("object") ?? "contact";
  const fields = CORE_FIELDS[object] ?? [];
  const permissions = await prisma.coreFieldPermission.findMany({
    where: { object },
    select: { fieldKey: true, role: true, access: true },
  });
  return NextResponse.json({ data: { object, fields, roles: ROLES, permissions } });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const { object, fieldKey, role, access } = parsed.data;

  if (!coreFieldKeys(object).has(fieldKey)) {
    return NextResponse.json({ error: "Campo core desconocido" }, { status: 400 });
  }

  // EDIT es el default → al elegir EDIT borramos la fila (mantiene la tabla limpia).
  if (access === "EDIT") {
    await prisma.coreFieldPermission.deleteMany({ where: { object, fieldKey, role } });
  } else {
    await prisma.coreFieldPermission.upsert({
      where: { object_fieldKey_role: { object, fieldKey, role } },
      update: { access },
      create: { object, fieldKey, role, access },
    });
  }

  await prisma.auditLog.create({
    data: {
      action: "UPDATE",
      entity: "CoreFieldPermission",
      entityId: `${object}.${fieldKey}.${role}`,
      userId: session.user.id,
      changes: { access },
    },
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
