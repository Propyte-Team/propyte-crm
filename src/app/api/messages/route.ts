// Endpoint para obtener mensajes de un contacto (paginados)
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getContactAccessInfo } from "@/server/contacts";

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const contactId = searchParams.get("contactId");
  const cursor = searchParams.get("cursor");
  const limit = parseInt(searchParams.get("limit") || "50");

  if (!contactId) {
    return NextResponse.json({ error: "contactId es requerido" }, { status: 400 });
  }

  // Marcas (2026-10-12): esta ruta devolvía los mensajes de CUALQUIER contacto con solo tener
  // sesión. Ahora pasa por el mismo gate que la cronología del contacto (rol + marca), con el
  // mismo mapeo: inexistente o de otra marca → 404, fuera del alcance por rol → 403.
  const access = await getContactAccessInfo(contactId, session as any);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.reason === "not_found" ? "Contacto no encontrado" : "No tienes acceso a este contacto" },
      { status: access.reason === "not_found" ? 404 : 403 }
    );
  }

  try {
    const messages = await prisma.message.findMany({
      where: { contactId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    const hasMore = messages.length > limit;
    const data = hasMore ? messages.slice(0, limit) : messages;

    return NextResponse.json({
      messages: data,
      nextCursor: hasMore ? data[data.length - 1].id : null,
    });
  } catch (error) {
    console.error("Error obteniendo mensajes:", error);
    return NextResponse.json(
      { error: "Error al obtener mensajes" },
      { status: 500 }
    );
  }
}
