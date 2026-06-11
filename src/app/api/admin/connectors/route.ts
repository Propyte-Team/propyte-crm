// CRUD de conectores de leads (Anexo B §H.7) — solo Dirección/Admin/Marketing.
// Las credenciales se cifran al guardar y NUNCA se devuelven (redact).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { writeCredentials } from "@/lib/intake/connectors";
import {
  connectorCredentialsMetaSchema,
  connectorCredentialsTikTokSchema,
  connectorCredentialsWebsiteSchema,
} from "@/lib/validations/rebuild-f1";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

const createSchema = z.object({
  name: z.string().min(2).max(120),
  provider: z.enum(["META", "TIKTOK", "WEBSITE", "ZAPIER", "MANUAL"]),
  credentials: z.record(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
  fieldMap: z.record(z.string()).optional(),
});

function credentialsSchemaFor(provider: string) {
  if (provider === "META") return connectorCredentialsMetaSchema;
  if (provider === "TIKTOK") return connectorCredentialsTikTokSchema;
  if (provider === "WEBSITE") return connectorCredentialsWebsiteSchema;
  return z.record(z.string());
}

async function assertRole() {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) return null;
  return session;
}

export async function GET() {
  const session = await assertRole();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const connectors = await prisma.leadConnector.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, provider: true, status: true, config: true, fieldMap: true,
      lastLeadAt: true, lastSyncAt: true, errorCount: true, lastError: true, createdAt: true,
      credentials: true,
      _count: { select: { leadLogs: true } },
    },
  });
  // redact: solo indicar si hay credenciales, jamás el contenido
  const safe = connectors.map(({ credentials, ...rest }) => ({
    ...rest,
    hasCredentials: !!credentials,
  }));
  return NextResponse.json({ data: safe });
}

export async function POST(req: NextRequest) {
  const session = await assertRole();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let encrypted: string | null = null;
  if (parsed.data.credentials) {
    const credsCheck = credentialsSchemaFor(parsed.data.provider).safeParse(parsed.data.credentials);
    if (!credsCheck.success) {
      return NextResponse.json({ error: credsCheck.error.flatten() }, { status: 400 });
    }
    encrypted = writeCredentials(parsed.data.credentials);
  }

  const connector = await prisma.leadConnector.create({
    data: {
      name: parsed.data.name,
      provider: parsed.data.provider,
      status: encrypted ? "PAUSED" : "PAUSED", // se activa explícitamente tras probar
      credentials: encrypted,
      config: (parsed.data.config ?? {}) as never,
      fieldMap: (parsed.data.fieldMap ?? {}) as never,
    },
    select: { id: true, name: true, provider: true, status: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "CREATE",
      entity: "LeadConnector",
      entityId: connector.id,
      changes: { name: connector.name, provider: connector.provider },
    },
  }).catch(() => {});

  return NextResponse.json({ data: connector }, { status: 201 });
}
