// ============================================================
// API Route: /api/quotes/[id]
// PATCH - Actualiza cotización parcialmente
// DELETE - Soft delete cotización
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { updateQuote, deleteQuote } from "@/server/quotes";
import { FUERA_DE_ALCANCE } from "@/lib/rbac/deal-access";
import { SOLO_LECTURA_COTIZACIONES } from "@/lib/rbac/quote-scope";

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const result = await updateQuote(params.id, body);

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        // #711: fuera de alcance es 404, no 403: un 403 confirma que el id existe.
        {
          status:
            result.error === FUERA_DE_ALCANCE ? 404
            // #867: rol de solo lectura (DIRECTOR, MARKETING): ve la cotización, no la modifica.
            : result.error === SOLO_LECTURA_COTIZACIONES ? 403
            : 400,
        },
      );
    }

    return NextResponse.json({ data: result.quote });
  } catch (error) {
    if (error instanceof Error && error.message === FUERA_DE_ALCANCE) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[PATCH /api/quotes/[id]]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // #867: antes borraba con solo tener sesión, sin mirar de quién era la cotización.
    const result = await deleteQuote(params.id);
    if ("error" in result) {
      const status =
        result.error === FUERA_DE_ALCANCE || result.error === "Cotización no encontrada" ? 404
        : result.error === SOLO_LECTURA_COTIZACIONES ? 403
        : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === FUERA_DE_ALCANCE) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[DELETE /api/quotes/[id]]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
