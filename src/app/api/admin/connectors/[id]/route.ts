// PATCH/DELETE de un conector (Anexo B §H.7). PATCH acepta status/credenciales/config/fieldMap.
// 2026-10-09: también brandId (null = cuenta sin marca, es decir, la predeterminada).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { writeCredentials } from "@/lib/intake/connectors";
import { fieldMapSchema } from "@/lib/intake/mapping-model";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "ERROR"]).optional(),
  credentials: z.record(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
  fieldMap: fieldMapSchema.optional(),
  brandId: z.string().uuid().nullable().optional(),
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Solo marcas vivas: una borrada o inventada dejaría la cuenta apuntando a una marca sin agente.
  if (typeof parsed.data.brandId === "string") {
    const brand = await prisma.brand.findFirst({
      where: { id: parsed.data.brandId, deletedAt: null },
      select: { id: true },
    });
    if (!brand) return NextResponse.json({ error: "Marca no encontrada" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name) data.name = parsed.data.name;
  if (parsed.data.status) data.status = parsed.data.status;
  if (parsed.data.config) data.config = parsed.data.config;
  if (parsed.data.fieldMap) data.fieldMap = parsed.data.fieldMap;
  if (parsed.data.brandId !== undefined) data.brandId = parsed.data.brandId;
  if (parsed.data.credentials) {
    data.credentials = writeCredentials(parsed.data.credentials);
    data.errorCount = 0;
    data.lastError = null;
  }

  const connector = await prisma.leadConnector.update({
    where: { id: params.id },
    data: data as never,
    select: { id: true, name: true, provider: true, status: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "LeadConnector",
      entityId: connector.id,
      changes: { fields: Object.keys(data) },
    },
  }).catch(() => {});

  return NextResponse.json({ data: connector });
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  await prisma.leadConnector.update({
    where: { id: params.id },
    data: { deletedAt: new Date(), status: "PAUSED" },
  });

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "DELETE",
      entity: "LeadConnector",
      entityId: params.id,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
