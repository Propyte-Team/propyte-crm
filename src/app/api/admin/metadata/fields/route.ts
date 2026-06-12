// Editor de campos (speckit §3.5) — GET catálogo · POST crear · PATCH editar/archivar.
// Gobernanza: solo ADMIN crea; apiName/type INMUTABLES; duplicados → warning; AuditLog.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { validateApiName, findSimilarFields } from "@/lib/metadata/governance";
import { invalidateMetadataCache } from "@/lib/metadata/registry";

const FIELD_TYPES = [
  "TEXT", "TEXTAREA", "NUMBER", "CURRENCY", "PERCENT", "DATE", "DATETIME", "BOOLEAN",
  "EMAIL", "PHONE", "URL", "PICKLIST", "MULTI_PICKLIST", "USER", "LOOKUP",
] as const; // AUTO_NUMBER/FORMULA/FILE/MASTER_DETAIL/ROLLUP/GEO llegan en P4

const createSchema = z.object({
  objectApiName: z.string().min(2),
  apiName: z.string().min(3).max(60),
  label: z.string().min(1).max(120),
  fieldType: z.enum(FIELD_TYPES),
  isRequired: z.boolean().default(false),
  isSearchable: z.boolean().default(false),
  helpText: z.string().max(500).optional(),
  validation: z.record(z.unknown()).default({}),
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1), color: z.string().optional() })).optional(),
  force: z.boolean().default(false), // crea aunque haya similares (tras ver el warning)
});

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const object = req.nextUrl.searchParams.get("object") ?? undefined;
  const fields = await prisma.customFieldDef.findMany({
    where: { ...(object ? { objectApiName: object } : {}), archivedAt: null },
    orderBy: [{ objectApiName: "asc" }, { order: "asc" }],
    include: { options: { orderBy: { order: "asc" } }, permissions: true },
  });
  return NextResponse.json({ data: fields });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN crea campos (PC2)" }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  // 1. Objeto existe y no es externo
  const object = await prisma.customObjectDef.findUnique({ where: { apiName: data.objectApiName } });
  if (!object || object.isExternal) {
    return NextResponse.json({ error: "Objeto inexistente o externo (read-only)" }, { status: 422 });
  }

  // 2. Convención de nombre
  const nameCheck = validateApiName(data.objectApiName, data.apiName);
  if (!nameCheck.ok) return NextResponse.json({ error: nameCheck.reason }, { status: 422 });

  // 3. Detector de duplicados semánticos (anti-sprawl)
  const existing = await prisma.customFieldDef.findMany({
    where: { objectApiName: data.objectApiName, archivedAt: null },
    select: { apiName: true, label: true },
  });
  const similar = findSimilarFields(data.apiName, data.label, existing);
  if (similar.length > 0 && !data.force) {
    return NextResponse.json(
      { error: "Posibles duplicados — revisa antes de crear", similar, hint: "Reenvía con force:true para crear de todos modos" },
      { status: 409 }
    );
  }

  // 4. PICKLIST requiere opciones
  if ((data.fieldType === "PICKLIST" || data.fieldType === "MULTI_PICKLIST") && !data.options?.length) {
    return NextResponse.json({ error: "PICKLIST requiere opciones" }, { status: 422 });
  }

  const field = await prisma.customFieldDef.create({
    data: {
      objectApiName: data.objectApiName,
      apiName: data.apiName,
      label: data.label,
      fieldType: data.fieldType,
      isRequired: data.isRequired,
      isSearchable: data.isSearchable,
      helpText: data.helpText,
      validation: data.validation as object,
      options: data.options?.length
        ? { create: data.options.map((o, i) => ({ ...o, order: (i + 1) * 10 })) }
        : undefined,
    },
    include: { options: true },
  });

  invalidateMetadataCache(data.objectApiName);
  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "CREATE", entity: "CustomFieldDef", entityId: field.id, changes: { apiName: field.apiName, fieldType: field.fieldType } },
  }).catch(() => {});

  return NextResponse.json({ data: field, similarWarning: similar.length ? similar : undefined }, { status: 201 });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(120).optional(),
  helpText: z.string().max(500).nullable().optional(),
  isRequired: z.boolean().optional(),
  isSearchable: z.boolean().optional(),
  validation: z.record(z.unknown()).optional(),
  order: z.number().int().optional(),
  archive: z.boolean().optional(), // soft: conserva valores (PC6)
});

export async function PATCH(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id, archive, ...rest } = parsed.data;

  const existing = await prisma.customFieldDef.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No existe" }, { status: 404 });
  if (existing.isSystem) return NextResponse.json({ error: "Campo núcleo: no editable desde el editor" }, { status: 422 });

  const field = await prisma.customFieldDef.update({
    where: { id },
    data: {
      ...rest,
      validation: rest.validation as object | undefined,
      ...(archive ? { archivedAt: new Date(), isActive: false } : {}),
    },
  });

  invalidateMetadataCache(field.objectApiName);
  await prisma.auditLog.create({
    data: { userId: session.user.id, action: "UPDATE", entity: "CustomFieldDef", entityId: id, changes: JSON.parse(JSON.stringify({ ...rest, archive })) },
  }).catch(() => {});

  return NextResponse.json({ data: field });
}
