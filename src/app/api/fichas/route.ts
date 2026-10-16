// POST /api/fichas — el asesor con sesión pide el enlace de la ficha técnica de un desarrollo o
// de una unidad (#887). Idempotente: pedir dos veces lo mismo devuelve el mismo enlace.
//
// Cualquier usuario con sesión puede compartir: el catálogo publicado es el mismo que ve
// cualquiera en propyte.com, y lo que se agrega es SU contacto, nunca el de otro asesor
// (el userId sale de la sesión, no del cuerpo).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { obtenerOCrearFicha, type ErrorCrearFicha } from "@/server/fichas";
import { origenPublico, rutaFicha } from "@/lib/fichas/ficha";

const cuerpo = z.object({
  developmentId: z.string().trim().min(1).max(200),
  unitId: z.string().trim().min(1).max(200).nullish(),
});

const ERRORES: Record<ErrorCrearFicha, { status: number; mensaje: string }> = {
  catalogo: { status: 503, mensaje: "No se pudo consultar el catálogo. Intenta de nuevo en un momento." },
  desarrollo_no_publicado: { status: 404, mensaje: "Este desarrollo no está publicado; no se puede compartir su ficha." },
  unidad_no_publicada: { status: 404, mensaje: "Esta unidad no está publicada; no se puede compartir su ficha." },
  unidad_de_otro_desarrollo: { status: 400, mensaje: "La unidad no pertenece a ese desarrollo." },
  sin_migracion: { status: 503, mensaje: "Las fichas compartibles aún no están activadas (falta aplicar la migración)." },
};

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = cuerpo.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "developmentId es requerido" }, { status: 400 });
  }

  try {
    const r = await obtenerOCrearFicha({
      userId: session.user.id,
      developmentId: parsed.data.developmentId,
      unitId: parsed.data.unitId ?? null,
    });
    if (!r.ok) {
      const e = ERRORES[r.error];
      return NextResponse.json({ error: e.mensaje, code: r.error }, { status: e.status });
    }
    const url = `${origenPublico(request.nextUrl.origin)}${rutaFicha(r.token)}`;
    return NextResponse.json({
      data: {
        token: r.token,
        url,
        titulo: r.vista.titulo,
        subtitulo: r.vista.subtitulo,
        tipo: r.vista.tipo,
        contacto: r.contacto,
        faltantes: r.faltantes,
        aperturas: r.aperturas,
        ultimaApertura: r.ultimaApertura,
      },
    });
  } catch (err) {
    console.error("[POST /api/fichas]", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
