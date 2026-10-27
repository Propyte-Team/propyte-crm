// POST: «Conectar WhatsApp (oficial)» de una MARCA (2026-10-14) — alta por Embedded Signup v4 de
// un número que sigue usándose en la app de WhatsApp Business (coexistencia).
// Spec: docs/superpowers/specs/2026-10-14-whatsapp-coexistencia-design.md §5.
//
// Recibe lo que el flujo de Meta devolvió al navegador ({ code, waba_id, phone_number_id? }) más la
// marca, y el orquestador hace lo demás: canje del código por el token de negocio, suscripción de
// la app a la WABA, alta o actualización de la cuenta WHATSAPP (token cifrado, alcance BRAND) y
// pedido de sincronización de contactos e historial. Mismo número dos veces = se actualiza la
// cuenta, no se duplica.
//
// Mismos roles que el resto de Conexiones. Nunca salen en la respuesta ni en un log el token, el
// código ni el App Secret.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { onboardCoexistenceNumber } from "@/lib/whatsapp/coex/onboard";

export const dynamic = "force-dynamic";
// Peor caso: canje + números de la WABA + datos del número + suscripción + 2 sincronizaciones,
// cada una con 10 s de tope. Sin esto la plataforma corta y el admin ve un error aunque el alta
// sí se haya hecho.
export const maxDuration = 60;

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

// Los IDs de Meta son numéricos; se validan para que nada raro acabe en una URL de Graph.
const metaId = z.string().regex(/^\d{5,32}$/, "ID de Meta inválido");

const bodySchema = z.object({
  code: z.string().min(10).max(4096),
  wabaId: metaId,
  phoneNumberId: metaId.nullable().optional(),
  brandId: z.string().guid().nullable().optional(),
  name: z.string().trim().min(2).max(120).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // Sin el detalle de zod: repetiría el valor recibido, y uno de los campos es el código.
    const campos = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    return NextResponse.json({ error: `Datos del alta inválidos (${campos || "cuerpo"}).` }, { status: 400 });
  }
  const { code, wabaId, phoneNumberId, brandId, name } = parsed.data;

  // Solo marcas vivas: una borrada o inventada dejaría la cuenta apuntando a una marca sin agente.
  if (typeof brandId === "string") {
    const brand = await prisma.brand.findFirst({ where: { id: brandId, deletedAt: null }, select: { id: true } });
    if (!brand) return NextResponse.json({ error: "Marca no encontrada" }, { status: 400 });
  }

  const result = await onboardCoexistenceNumber({
    code,
    wabaId,
    phoneNumberId: phoneNumberId ?? null,
    scope: "BRAND",
    brandId,
    name: name ?? null,
    actorUserId: session.user.id,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const { created, connector, number, subscription, sync, warnings } = result;
  return NextResponse.json(
    { data: { created, connector, number, subscription, sync, warnings } },
    { status: created ? 201 : 200 },
  );
}
