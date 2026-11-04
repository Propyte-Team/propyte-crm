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
  validation: z.record(z.string(), z.unknown()).default({}),
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1), color: z.string().optional() })).optional(),
  force: z.boolean().default(false), // crea aunque haya similares (tras ver el warning)
});

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const object = req.nextUrl.searchParams.get("object") ?? undefined;
  // ?archived=1 → solo los archivados (para restaurarlos); por defecto solo los activos.
  const archivados = req.nextUrl.searchParams.get("archived") === "1";
  const fields = await prisma.customFieldDef.findMany({
    where: { ...(object ? { objectApiName: object } : {}), archivedAt: archivados ? { not: null } : null },
    orderBy: [{ objectApiName: "asc" }, { order: "asc" }],
    include: { options: { where: { isActive: true }, orderBy: { order: "asc" } }, permissions: true },
  });
  return NextResponse.json({ data: fields });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo un administrador puede crear campos" }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  // 1. Objeto existe y no es externo
  const object = await prisma.customObjectDef.findUnique({ where: { apiName: data.objectApiName } });
  if (!object || object.isExternal) {
    return NextResponse.json({ error: "El módulo no existe o es externo (solo lectura)" }, { status: 422 });
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
    return NextResponse.json({ error: "Agrega al menos una opción a la lista" }, { status: 422 });
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

const ACCESOS = ["HIDDEN", "READ", "EDIT"] as const;
const ROLES = [
  "ADMIN", "ASESOR", "BROKER", "MANTENIMIENTO", "DIRECTOR", "GERENTE",
  "TEAM_LEADER", "ASESOR_SR", "ASESOR_JR", "HOSTESS", "MARKETING", "DEVELOPER_EXT",
] as const;

// PATCH: etiqueta, ayuda, orden, opciones de lista y permisos por rol. NO cambia tipo ni apiName.
// archive:true archiva; archive:false restaura un campo archivado.
const patchSchema = z.object({
  id: z.string().guid(),
  label: z.string().min(1).max(120).optional(),
  helpText: z.string().max(500).nullable().optional(),
  isRequired: z.boolean().optional(),
  isSearchable: z.boolean().optional(),
  validation: z.record(z.string(), z.unknown()).optional(),
  order: z.number().int().optional(),
  archive: z.boolean().optional(), // soft: conserva valores (PC6)
  // Reemplaza la lista de opciones: las que falten se desactivan (nunca se borran)
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1), color: z.string().optional() })).optional(),
  // Acceso por rol (sin fila = ADMIN edita, los demás solo leen)
  permissions: z.array(z.object({ role: z.enum(ROLES), access: z.enum(ACCESOS) })).optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo un administrador puede editar campos" }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { id, archive, options, permissions, ...rest } = parsed.data;

  const existing = await prisma.customFieldDef.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "El campo no existe" }, { status: 404 });
  if (existing.isSystem) return NextResponse.json({ error: "Campo núcleo: no editable desde el editor" }, { status: 422 });

  if (options) {
    if (existing.fieldType !== "PICKLIST" && existing.fieldType !== "MULTI_PICKLIST") {
      return NextResponse.json({ error: "Solo los campos de tipo lista tienen opciones" }, { status: 422 });
    }
    if (options.length === 0) return NextResponse.json({ error: "Agrega al menos una opción a la lista" }, { status: 422 });
    const valores = options.map((o) => o.value);
    if (new Set(valores).size !== valores.length) {
      return NextResponse.json({ error: "Hay opciones repetidas" }, { status: 422 });
    }
  }

  const field = await prisma.customFieldDef.update({
    where: { id },
    data: {
      ...rest,
      validation: rest.validation as object | undefined,
      ...(archive === true ? { archivedAt: new Date(), isActive: false } : {}),
      ...(archive === false ? { archivedAt: null, isActive: true } : {}),
    },
  });

  if (options) {
    await prisma.$transaction([
      ...options.map((o, i) =>
        prisma.fieldOption.upsert({
          where: { fieldId_value: { fieldId: id, value: o.value } },
          update: { label: o.label, color: o.color ?? null, order: (i + 1) * 10, isActive: true },
          create: { fieldId: id, value: o.value, label: o.label, color: o.color, order: (i + 1) * 10 },
        })
      ),
      prisma.fieldOption.updateMany({
        where: { fieldId: id, value: { notIn: options.map((o) => o.value) } },
        data: { isActive: false },
      }),
    ]);
  }

  if (permissions?.length) {
    await prisma.$transaction(
      permissions.map((p) =>
        prisma.fieldPermission.upsert({
          where: { fieldId_role: { fieldId: id, role: p.role } },
          update: { access: p.access },
          create: { fieldId: id, role: p.role, access: p.access },
        })
      )
    );
  }

  invalidateMetadataCache(field.objectApiName);
  await prisma.auditLog.create({
    data: {
      userId: session.user.id, action: "UPDATE", entity: "CustomFieldDef", entityId: id,
      changes: JSON.parse(JSON.stringify({ ...rest, archive, options, permissions })),
    },
  }).catch(() => {});

  return NextResponse.json({ data: field });
}
