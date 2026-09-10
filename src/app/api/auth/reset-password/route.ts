// Endpoint: verificar código OTP y cambiar contraseña
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { hash, compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { registrarIntento, olvidarIntentos } from "@/lib/security/rate-limit";

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
    const correo = email.toLowerCase().trim();

    // #714 (S-06) — ESTE es el tope que importa. La #742 lo midió: el código de 6 dígitos
    // vive 10 minutos y hasta ahora se podía probar sin límite dentro de esa ventana. Son
    // 10^6 combinaciones y este endpoint CAMBIA LA CONTRASEÑA, así que acertar es quedarse
    // con la cuenta. Con 5 intentos por ventana el espacio deja de ser recorrible.
    //
    // Va por correo y no por IP: el blanco es una cuenta concreta, y quien ataque va a
    // rotar IPs antes que correos. El coste es que alguien puede dejar a un usuario sin
    // poder verificar durante diez minutos quemándole los intentos — es el compromiso
    // habitual, y pesa menos que dejar el código a fuerza bruta.
    const limite = registrarIntento("otp_verificar", correo);
    if (!limite.permitido) {
      return NextResponse.json(
        { error: "Demasiados intentos. Espera unos minutos y solicita un código nuevo." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(limite.esperarMs / 1000)) } }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: correo },
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

    // El intento salió bien: se olvidan los fallos previos. Sin esto, quien se equivoca
    // cuatro veces y acierta a la quinta se queda a un fallo de quedar bloqueado los
    // siguientes diez minutos, y ya demostró que la cuenta es suya.
    olvidarIntentos("otp_verificar", correo);

    return NextResponse.json({ message: "Contraseña actualizada correctamente" });
  } catch (error) {
    console.error("Error en reset-password:", error);
    return NextResponse.json({ error: "Error al procesar la solicitud" }, { status: 500 });
  }
}
