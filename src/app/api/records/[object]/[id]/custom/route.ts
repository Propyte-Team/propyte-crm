// Valores custom de un record núcleo (Contact/Deal) — GET defs+valores · PATCH con
// validación zod-from-registry + field-level security (speckit §3.4/PC5).
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { getActiveFields, visibleFields, buildZodFromRegistry } from "@/lib/metadata/registry";
import type { UserRole } from "@prisma/client";

const SUPPORTED: Record<string, "contact" | "deal"> = { contact: "contact", deal: "deal" };

async function loadRecord(object: "contact" | "deal", id: string) {
  if (object === "contact") {
    return prisma.contact.findUnique({ where: { id }, select: { id: true, custom: true } });
  }
  return prisma.deal.findUnique({ where: { id }, select: { id: true, custom: true } });
}

export async function GET(req: NextRequest, { params }: { params: { object: string; id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const object = SUPPORTED[params.object];
  if (!object) return NextResponse.json({ error: "Objeto no soportado" }, { status: 404 });

  const record = await loadRecord(object, params.id);
  if (!record) return NextResponse.json({ error: "Record no existe" }, { status: 404 });

  const fields = await getActiveFields(object);
  const visible = visibleFields(fields, session.user.role as UserRole);
  const values = (record.custom ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    data: visible.map(({ field, canEdit }) => ({
      apiName: field.apiName,
      label: field.label,
      fieldType: field.fieldType,
      isRequired: field.isRequired,
      helpText: field.helpText,
      options: field.options.map((o) => ({ value: o.value, label: o.label, color: o.color })),
      canEdit,
      value: values[field.apiName] ?? null,
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { object: string; id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const object = SUPPORTED[params.object];
  if (!object) return NextResponse.json({ error: "Objeto no soportado" }, { status: 404 });

  const record = await loadRecord(object, params.id);
  if (!record) return NextResponse.json({ error: "Record no existe" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const fields = await getActiveFields(object);
  const visible = visibleFields(fields, session.user.role as UserRole);

  // Solo claves que el rol puede EDITAR
  const editable = new Set(visible.filter((v) => v.canEdit).map((v) => v.field.apiName));
  for (const key of Object.keys(body)) {
    if (!editable.has(key)) {
      return NextResponse.json({ error: `Sin permiso o campo inexistente: ${key}` }, { status: 403 });
    }
  }

  const validator = buildZodFromRegistry(visible.map((v) => v.field));
  const parsed = validator.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const merged = { ...((record.custom ?? {}) as object), ...(parsed.data as object) };
  if (object === "contact") {
    await prisma.contact.update({ where: { id: params.id }, data: { custom: merged } });
  } else {
    await prisma.deal.update({ where: { id: params.id }, data: { custom: merged } });
  }

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: object === "contact" ? "Contact.custom" : "Deal.custom",
      entityId: params.id,
      changes: parsed.data as object,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, data: merged });
}
