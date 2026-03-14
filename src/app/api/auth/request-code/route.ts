// Endpoint para solicitar un código de acceso temporal por email
import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import { sendLoginCode } from "@/lib/email/resend";
import { z } from "zod";
import crypto from "crypto";

const requestCodeSchema = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = requestCodeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Correo electrónico inválido" },
        { status: 400 }
      );
    }

    const email = parsed.data.email.toLowerCase().trim();

    // Buscar usuario activo con ese correo
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, isActive: true, email: true },
    });

    // Respuesta genérica para no revelar si el correo existe
    if (!user || !user.isActive) {
      return NextResponse.json({
        message: "Si el correo está registrado, recibirás un código de acceso.",
      });
    }

    // Generar código de 6 dígitos
    const code = crypto.randomInt(100000, 999999).toString();

    // Hashear y guardar como contraseña del usuario
    const passwordHash = await hash(code, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Enviar código por email
    await sendLoginCode(user.email, code);

    return NextResponse.json({
      message: "Si el correo está registrado, recibirás un código de acceso.",
    });
  } catch (error) {
    console.error("Error en request-code:", error);
    return NextResponse.json(
      { error: "Error al procesar la solicitud" },
      { status: 500 }
    );
  }
}
