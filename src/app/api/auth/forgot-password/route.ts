// Endpoint: solicitar código de restablecimiento de contraseña
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import { sendPasswordResetCode } from "@/lib/email/resend";
import { z } from "zod";
import crypto from "crypto";

const schema = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Correo electrónico inválido" }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, isActive: true, email: true },
    });

    // Respuesta genérica para no revelar si el correo existe
    if (!user || !user.isActive) {
      return NextResponse.json({
        message: "Si el correo está registrado, recibirás un código para restablecer tu contraseña.",
      });
    }

    // Generar código de 6 dígitos
    const code = crypto.randomInt(100000, 999999).toString();
    const otpHash = await hash(code, 12);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

    await prisma.user.update({
      where: { id: user.id },
      data: { otpHash, otpExpiresAt },
    });

    await sendPasswordResetCode(user.email, code);

    return NextResponse.json({
      message: "Si el correo está registrado, recibirás un código para restablecer tu contraseña.",
    });
  } catch (error) {
    console.error("Error en forgot-password:", error);
    return NextResponse.json({ error: "Error al procesar la solicitud" }, { status: 500 });
  }
}
