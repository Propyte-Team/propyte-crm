// API Route: /api/request-access
// Recibe solicitudes de acceso desde el landing (BUG-15) y las notifica por correo.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendAccessRequest } from "@/lib/email/mailer";

const schema = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(120),
  email: z.string().trim().email("Email inválido"),
  company: z.string().trim().max(160).optional(),
  message: z.string().trim().max(1000).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    await sendAccessRequest(parsed.data);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("request-access:", err);
    return NextResponse.json(
      {
        error:
          "No se pudo enviar la solicitud. Intenta más tarde o escríbenos a marketing@propyte.com.",
      },
      { status: 500 }
    );
  }
}
