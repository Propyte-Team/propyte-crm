// Endpoint: verificar código OTP y cambiar contraseña
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { hash, compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  newPassword: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message || "Datos inválidos" },
        { status: 400 }
      );
    }

    const { email, code, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, isActive: true, otpHash: true, otpExpiresAt: true },
    });

    if (!user || !user.isActive) {
      return NextResponse.json({ error: "Código inválido o expirado" }, { status: 400 });
    }

    // Verificar OTP
    if (!user.otpHash || !user.otpExpiresAt) {
      return NextResponse.json({ error: "No se ha solicitado un código de restablecimiento" }, { status: 400 });
    }

    if (new Date() > user.otpExpiresAt) {
      return NextResponse.json({ error: "El código ha expirado. Solicita uno nuevo." }, { status: 400 });
    }

    const validCode = await compare(code, user.otpHash);
    if (!validCode) {
      return NextResponse.json({ error: "Código inválido" }, { status: 400 });
    }

    // Cambiar contraseña y limpiar OTP
    const passwordHash = await hash(newPassword, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        otpHash: null,
        otpExpiresAt: null,
      },
    });

    return NextResponse.json({ message: "Contraseña actualizada correctamente" });
  } catch (error) {
    console.error("Error en reset-password:", error);
    return NextResponse.json({ error: "Error al procesar la solicitud" }, { status: 500 });
  }
}
