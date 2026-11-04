// Permisos de campo CORE por rol (Fase B). GET catálogo + permisos · PUT upsert de una celda.
// Solo ADMIN edita (PC2). Default sin fila = EDIT.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { CORE_FIELDS, coreFieldKeys } from "@/lib/metadata/core-fields";
import { ROLES_CONFIGURABLES } from "@/lib/metadata/visibilidad-model";

const ROLES = ROLES_CONFIGURABLES;

// fieldKey (una celda) o fieldKeys (acción por grupo, atómica). Al menos uno.
const putSchema = z
  .object({
    object: z.string().min(2),
    fieldKey: z.string().min(1).optional(),
    fieldKeys: z.array(z.string().min(1)).min(1).max(200).optional(),
    role: z.enum(ROLES),
    access: z.enum(["HIDDEN", "READ", "EDIT"]),
  })
  .refine((v) => v.fieldKey || v.fieldKeys, { message: "Indica fieldKey o fieldKeys" });

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
  // Usuarios activos por rol: la pantalla avisa antes de ocultar campos a un rol con gente.
  const porRol = await prisma.user
    .groupBy({ by: ["role"], where: { isActive: true }, _count: { _all: true } })
    .catch(() => []);
  const usuariosActivos: Record<string, number> = {};
  for (const r of porRol) usuariosActivos[r.role as string] = r._count._all;
  return NextResponse.json({ data: { object, fields, roles: ROLES, permissions, usuariosActivos } });
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
  const { object, role, access } = parsed.data;
  const claves = [...new Set(parsed.data.fieldKeys ?? [parsed.data.fieldKey!])];

  const validas = coreFieldKeys(object);
  if (claves.some((k) => !validas.has(k))) {
    return NextResponse.json({ error: "Campo core desconocido" }, { status: 400 });
  }

  // EDIT es el default → al elegir EDIT borramos las filas (mantiene la tabla limpia).
  if (access === "EDIT") {
    await prisma.coreFieldPermission.deleteMany({ where: { object, fieldKey: { in: claves }, role } });
  } else {
    await prisma.$transaction(
      claves.map((fieldKey) =>
        prisma.coreFieldPermission.upsert({
          where: { object_fieldKey_role: { object, fieldKey, role } },
          update: { access },
          create: { object, fieldKey, role, access },
        })
      )
    );
  }

  await prisma.auditLog.create({
    data: {
      action: "UPDATE",
      entity: "CoreFieldPermission",
      entityId: `${object}.${claves.length === 1 ? claves[0] : `${claves.length}-campos`}.${role}`,
      userId: session.user.id,
      changes: { access, ...(claves.length > 1 ? { fieldKeys: claves } : {}) },
    },
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
