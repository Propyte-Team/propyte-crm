/**
 * #699 (defecto 2) — barrido de los códigos de un solo uso que ya no sirven.
 *
 * Las DOS vías que consumen un código lo borran al usarlo: el inicio de sesión con código
 * (`lib/auth/options.ts`) y el restablecimiento de contraseña (`api/auth/reset-password`).
 * Lo que faltaba es la otra mitad: un código que se PIDE y nunca se usa se queda guardado
 * para siempre. Medido el 2026-09-15 sobre producción: 3 de 17 cuentas con un hash de
 * código dentro, ninguno vigente, el más viejo vencido hace 94 días, y una de las tres es
 * ADMIN.
 *
 * POR QUÉ IMPORTA SI NINGUNO ES EXPLOTABLE. No lo es: está hasheado con bcrypt y las dos
 * vías comprueban la vigencia antes de comparar. Importa por dos razones distintas:
 *
 *  1. Es residuo de credencial. Un secreto derivado que ya no puede servir para nada no
 *     tiene por qué seguir en la fila.
 *  2. ENGAÑA A QUIEN AUDITA, y esto ya pasó. Al verificar la #650 este campo se leyó
 *     primero como «hay un cambio de contraseña a medias» y hubo que medir `otpExpiresAt`
 *     para descartarlo. Un `otpHash` presente debería significar «flujo vivo», y hoy no
 *     significa nada.
 *
 * LO QUE ESTO **NO** HACE, dicho aquí para que nadie lo suponga:
 *  - No acorta la vida de un código ni lo invalida antes de tiempo. Sólo retira los que la
 *    comprobación de vigencia YA rechaza.
 *  - No sustituye al borrado al consumir, que es el que cierra la ventana de verdad. Esto
 *    es la red de abajo, para los que nadie llegó a usar.
 *  - No toca `passwordHash` ni ningún otro campo.
 */
import prisma from "@/lib/db";

/**
 * Retira los códigos que ya no puede aceptar ninguna de las dos vías de consumo.
 *
 * SOBRE EL PREDICADO, que es todo lo que hay que revisar aquí:
 *
 * `lt` y NO `lte`, a propósito. Las dos vías rechazan con `new Date() > otpExpiresAt`
 * (options.ts:124 y reset-password/route.ts:62), o sea que en el instante exacto del
 * vencimiento el código TODAVÍA se acepta. Con `lte` este barrido borraría, durante ese
 * milisegundo, un código que el inicio de sesión aún daría por bueno. La ventana es
 * ridícula y el usuario vería «código inválido» sobre uno correcto; no cuesta nada tener
 * el borde del lado bueno.
 *
 * La rama `otpExpiresAt: null` con un hash presente también es residuo: las dos vías la
 * rechazan (`!user.otpHash || !user.otpExpiresAt`), así que ese hash no puede usarse nunca
 * y sin esta rama se quedaría dentro para siempre. Hoy no existe ninguna fila así —las dos
 * vías que ESCRIBEN el código ponen los dos campos juntos— y por eso mismo entra: es
 * exactamente el estado que nadie limpiaría si llegara a aparecer.
 *
 * UN SOLO `updateMany`, SIN TOPE, y no es un descuido de las otras etapas del tick, que sí
 * lo llevan. Dos razones. La primera es de correción: Postgres evalúa el predicado en el
 * momento de la escritura, así que un código pedido a mitad del barrido o no existe
 * todavía o ya no cumple la condición de vencido. Un `findMany` con `take` y luego un
 * update por ids tendría esa ventana, y borraría un código recién pedido. La segunda es de
 * tamaño: esto recorre `users`, que crece con la plantilla —17 filas hoy—, no con el
 * tráfico.
 *
 * @param ahora inyectable para las pruebas; en el tick es la hora del tick.
 * @returns cuántas filas se limpiaron, para que el cuerpo del tick lo reporte.
 */
export async function limpiarOtpVencidos(ahora: Date = new Date()): Promise<number> {
  const { count } = await prisma.user.updateMany({
    where: {
      otpHash: { not: null },
      OR: [{ otpExpiresAt: { lt: ahora } }, { otpExpiresAt: null }],
    },
    data: { otpHash: null, otpExpiresAt: null },
  });

  return count;
}
