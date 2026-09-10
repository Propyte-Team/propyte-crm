// Endpoint para solicitar un código de acceso temporal por email
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import { sendLoginCode } from "@/lib/email/mailer";
import { z } from "zod";
import { registrarIntento, olvidarIntentos, ipDe } from "@/lib/security/rate-limit";
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

    // #714 (S-06): tope de intentos ANTES de tocar la base. El riesgo de este endpoint no
    // es adivinar nada —el codigo se genera aqui— es usar el CRM para bombardear de correos
    // a una persona, y de paso hacerle bcrypt(12) por cada peticion.
    //
    // Se cuenta por correo Y por IP, y hacen falta las dos: solo por correo, quien quiera
    // molestar rota correos; solo por IP, quien tenga muchas IPs igual bombardea a UNA
    // persona. El 429 no filtra nada: se cuenta antes de saber si el correo existe, asi que
    // dice «mandaste muchas», nunca «este correo esta registrado».
    const ip = ipDe(req.headers);
    const porCorreo = registrarIntento("otp_solicitar", email);
    const porIp = ip ? registrarIntento("otp_solicitar", `ip:${ip}`) : { permitido: true, esperarMs: 0 };
    if (!porCorreo.permitido || !porIp.permitido) {
      const esperarMs = Math.max(porCorreo.esperarMs, porIp.esperarMs);
      return NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(esperarMs / 1000)) } }
      );
    }


    // Buscar usuario activo
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

    // Hashear y guardar en campos OTP separados (NO sobreescribe la contraseña)
    const otpHash = await hash(code, 12);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

    await prisma.user.update({
      where: { id: user.id },
      data: { otpHash, otpExpiresAt },
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
