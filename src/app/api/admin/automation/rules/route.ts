// CRUD de reglas de automatización para el builder visual (Fase 4, T4.2).
// POST crear · PUT editar. Solo Dirección/Admin. Valida DSL de condiciones y acciones.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { conditionsDslSchema, workflowActionTypes, TRIGGER_TYPES } from "@/lib/validations/rebuild-f1";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

const ruleSchema = z.object({
  name: z.string().min(3).max(120).trim(),
  description: z.string().max(500).optional().nullable(),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: z.record(z.unknown()).default({}),
  conditions: conditionsDslSchema,
  actions: z
    .array(z.object({
      type: z.enum(workflowActionTypes),
      config: z.record(z.unknown()).default({}),
      delayMinutes: z.number().int().min(0).optional(),
    }))
    .min(1, "Agrega al menos una acción"),
  cooldownMinutes: z.number().int().min(0).max(43200).optional().nullable(),
  priority: z.number().int().min(1).max(1000).default(100),
  isActive: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const parsed = ruleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const dup = await prisma.automationRule.findFirst({ where: { name: d.name, deletedAt: null } });
  if (dup) return NextResponse.json({ error: "Ya existe una regla con ese nombre" }, { status: 409 });

  const rule = await prisma.automationRule.create({
    data: {
      name: d.name,
      description: d.description ?? null,
      triggerType: d.triggerType,
      triggerConfig: d.triggerConfig as never,
      conditions: d.conditions as never,
      actions: d.actions as never,
      cooldownMinutes: d.cooldownMinutes ?? null,
      priority: d.priority,
      isActive: d.isActive,
    },
  });
  await audit(session.user.id, "CREATE", rule.id, d.name);
  return NextResponse.json({ data: rule }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const existing = await prisma.automationRule.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });

  const dup = await prisma.automationRule.findFirst({ where: { name: d.name, deletedAt: null, id: { not: id } } });
  if (dup) return NextResponse.json({ error: "Ya existe otra regla con ese nombre" }, { status: 409 });

  const rule = await prisma.automationRule.update({
    where: { id },
    data: {
      name: d.name,
      description: d.description ?? null,
      triggerType: d.triggerType,
      triggerConfig: d.triggerConfig as never,
      conditions: d.conditions as never,
      actions: d.actions as never,
      cooldownMinutes: d.cooldownMinutes ?? null,
      priority: d.priority,
      isActive: d.isActive,
    },
  });
  await audit(session.user.id, "UPDATE", rule.id, d.name);
  return NextResponse.json({ data: rule });
}

async function audit(userId: string, action: "CREATE" | "UPDATE", id: string, name: string) {
  await prisma.auditLog
    .create({ data: { action, entity: "AutomationRule", entityId: id, userId, changes: { name } } })
    .catch(() => null);
}
