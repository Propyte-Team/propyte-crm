// POST: reemplaza SOLO el Page Access Token de una cuenta de Instagram/Messenger (2026-10-10).
//
// Por qué existe: Marketing tiene que cambiar el token de 10 cuentas por los de un usuario
// del sistema de Meta, y Conexiones no ofrecía forma de hacerlo. Borrar y volver a crear la
// cuenta no es opción: conversaciones, reglas de comentarios y la marca apuntan al id del
// conector. Y el PATCH de /connectors/[id] REEMPLAZA el blob cifrado completo: mandarle
// solo el token borraría appSecret y verifyToken. Aquí se descifra lo que había, se cambia
// únicamente pageAccessToken y se vuelve a cifrar.
//
// Antes de escribir se pregunta a Meta de qué Página es el token (lib/messaging/page-token):
// si no es la de la cuenta, no se guarda. El token nunca sale en la respuesta ni en un log.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { readCredentials, writeCredentials } from "@/lib/intake/connectors";
import { verifyPageToken, pageMismatchMessage, mergePageToken } from "@/lib/messaging/page-token";

export const dynamic = "force-dynamic";

// Mismos roles que /api/admin/connectors: quien puede editar la cuenta puede cambiarle el token.
const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

// trim() va primero: zod 3 aplica los checks en orden, y así un token pegado con un salto de
// línea al final no cuenta como distinto ni un "   " pasa como no vacío. Los tokens de Meta
// rondan los 200-300 caracteres; 2048 deja margen sin aceptar cualquier cosa.
const bodySchema = z.object({
  pageAccessToken: z
    .string({ required_error: "Pega el token", invalid_type_error: "El token debe ser texto" })
    .trim()
    .min(1, "Pega el token")
    .max(2048, "El token es demasiado largo")
    .regex(/^\S+$/, "El token no puede tener espacios"),
});

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // Los mensajes de zod son los nuestros: ninguno repite el valor recibido.
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const token = parsed.data.pageAccessToken;

  const connector = await prisma.leadConnector.findFirst({
    where: { id: params.id, provider: { in: ["INSTAGRAM", "MESSENGER"] }, deletedAt: null },
  });
  if (!connector) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });

  const pageId = String((connector.config as { pageId?: string | number } | null)?.pageId ?? "").trim();
  if (!pageId) {
    return NextResponse.json({ error: "La cuenta no tiene pageId: no hay con qué comparar el token" }, { status: 400 });
  }

  // Si hay credenciales pero no se pueden descifrar, no se escribe: partir de {} borraría en
  // silencio appSecret y verifyToken, que es justo lo que esta ruta existe para evitar.
  const existing = readCredentials<Record<string, unknown>>(connector);
  if (connector.credentials && !existing) {
    return NextResponse.json(
      { error: "No se pudieron leer las credenciales actuales de la cuenta; no se guardó el token" },
      { status: 500 }
    );
  }

  const check = await verifyPageToken(token);
  if (!check.ok) {
    return check.kind === "graph"
      ? NextResponse.json({ error: `Meta rechazó el token: ${check.error}` }, { status: 400 })
      : NextResponse.json({ error: `No se pudo verificar el token con Meta: ${check.error}` }, { status: 502 });
  }
  if (check.pageId !== pageId) {
    return NextResponse.json({ error: pageMismatchMessage(check, pageId) }, { status: 400 });
  }

  // Token nuevo y verificado: los fallos acumulados eran del token anterior.
  await prisma.leadConnector.update({
    where: { id: connector.id },
    data: {
      credentials: writeCredentials(mergePageToken(existing, token)),
      errorCount: 0,
      lastError: null,
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "LeadConnector",
      entityId: connector.id,
      changes: { fields: ["credentials.pageAccessToken"], pageId: check.pageId, pageName: check.pageName },
    },
  }).catch(() => {});

  return NextResponse.json({ data: { pageId: check.pageId, pageName: check.pageName } });
}
