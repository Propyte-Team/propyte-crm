/**
 * #839 — qué hacen las dos rutas que mandan un código por correo (restablecer contraseña y
 * código de acceso) cuando el correo NO sale.
 *
 * Antes: el código se quedaba guardado, la ruta respondía 500 «Error al procesar la
 * solicitud» y la persona no sabía si reintentar, esperar o pedir ayuda. Ahora:
 *
 *  1. El código recién guardado se ANULA. Nadie lo recibió, así que no puede servir para nada,
 *     y un `otpHash` presente debe significar «flujo vivo» (mismo criterio que #699).
 *     Condicionado al hash que escribió ESTA petición: si entretanto otra pidió un código
 *     nuevo y ese sí salió, no se le borra.
 *  2. La ruta responde 503 con `codigo: "correo_no_enviado"`, y la pantalla dice «no pudimos
 *     enviar el correo, avisa al administrador».
 *  3. El aviso a los administradores ya lo dejó el mailer (`avisar-fallo-smtp.ts`).
 *
 * LO QUE ESTO DESTAPA, dicho para que nadie lo descubra después: con el correo caído, un 503
 * delata que la cuenta existe (para un correo que no existe la ruta sigue diciendo «si el correo
 * está registrado…»). No es nuevo —el 500 de antes delataba lo mismo— y queda acotado por el
 * tope de 3 solicitudes por 15 min por correo y por IP. Con el correo funcionando no cambia nada.
 */
import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export const CODIGO_CORREO_NO_ENVIADO = "correo_no_enviado";

export const MENSAJE_CORREO_NO_ENVIADO =
  "No pudimos enviar el correo con tu código. Avisa al administrador del CRM e inténtalo más tarde.";

/** Nunca lanza: si no se pudo anular, el código vence solo a los 10 minutos y lo barre el tick. */
export async function anularCodigoNoEnviado(userId: string, otpHash: string): Promise<boolean> {
  try {
    const { count } = await prisma.user.updateMany({
      where: { id: userId, otpHash },
      data: { otpHash: null, otpExpiresAt: null },
    });
    return count > 0;
  } catch (e) {
    console.error("[auth] no se pudo anular el código que no se envió", e);
    return false;
  }
}

export function respuestaCorreoNoEnviado() {
  return NextResponse.json(
    { error: MENSAJE_CORREO_NO_ENVIADO, codigo: CODIGO_CORREO_NO_ENVIADO },
    { status: 503 },
  );
}
