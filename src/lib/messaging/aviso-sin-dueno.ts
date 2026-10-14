/**
 * Aviso de una conversación «en manos de un humano» que no tiene humano (#858, 2026-10-14).
 *
 * EL FALLO. Cuando el bot escala a una persona (`escalateToHuman`, bot-respond.ts) y el
 * contacto no tiene asesor, la conversación queda en HUMAN con `controlledById` null: el bot
 * deja de contestar y el aviso «el bot te pasó una conversación» no sale, porque no hay a
 * quién. Los mensajes que siguen llegando tampoco avisan: la rama HUMAN del intake
 * (messaging/core.ts) solo notificaba a `controlledById ?? assignedToId`, los dos null. Caso
 * real: el valuador de BBVA que escribió el 2026-10-12 a las 16:14 para coordinar un avalúo
 * (conversación 9c1379d8). El bot le dijo que pasaba su mensaje a la persona responsable,
 * nadie se enteró, y dos días después seguía sin respuesta.
 *
 * A QUIÉN, en orden; el primero que dé alguien gana y los demás no se consultan:
 *   1. el responsable de marketing de la marca de la cuenta del hilo, si es una marca NO
 *      predeterminada (la marca tiene dueño propio: es quien atiende sus prospectos);
 *   2. la gerencia de la plaza del contacto (la misma consulta del Pond, workflows/gerencia.ts);
 *   3. los ADMIN que son personas.
 * «Persona» es `usuarioRuteableWhere()`: activo, no borrado, sin correo `.local`. Avisarle a
 * `agentes@propyte.local` sería repetir el fallo con otro nombre.
 *
 * El paso 3 es ADMIN y no «toda la gerencia» a propósito: sin plaza no hay una gerencia que
 * sea la del contacto, y mandárselo a los directores de todas las plazas es ruido para los
 * que no les toca.
 *
 * DEDUP POR HILO. Un aviso por conversación, no uno por mensaje: si el destinatario ya tiene
 * uno SIN LEER con el mismo enlace de las últimas horas, no se le repite. El enlace es la
 * clave porque es lo que identifica el hilo en la bandeja, y así el escalamiento y los
 * mensajes que lo siguen comparten el mismo aviso. Si lo leyó y el cliente vuelve a
 * escribir, sí se le avisa: eso ya es información nueva.
 *
 * NO asigna nada. Ni `controlledById` ni el asesor del contacto: con varios destinatarios no
 * hay uno que elegir, y tomar el hilo es decisión de quien conteste desde la bandeja. Tampoco
 * lanza nunca: un aviso perdido es malo, perder el escalamiento o la ingesta es peor.
 */
import prisma from "@/lib/db";
import { resolveBrandForConnector } from "@/lib/brands/resolve";
import { usuarioRuteableWhere } from "@/lib/workflows/ruteables";
import { gerenciaDeLaPlaza } from "@/lib/workflows/gerencia";

/** Cuánto vale un aviso sin leer del mismo hilo antes de volver a avisar. */
export const VENTANA_DEDUP_AVISO_MS = 6 * 60 * 60 * 1000;

export type ViaDelAviso = "responsable_marca" | "gerencia_plaza" | "admins";

export interface DestinatariosSinDueno {
  userIds: string[];
  via: ViaDelAviso | null;
  /** Nombre de la marca o la plaza, para decirle al destinatario por qué le llega. */
  detalle: string | null;
}

export async function destinatariosHiloSinDueno(input: {
  connectorId: string | null;
  plaza: string | null;
}): Promise<DestinatariosSinDueno> {
  // 1. Solo una marca NO predeterminada aporta responsable. "unavailable" (la cuenta apunta
  //    a una marca borrada o ilegible) no aporta a nadie y se sigue con la gerencia: avisar
  //    de más es preferible a no avisar.
  if (input.connectorId) {
    const res = await resolveBrandForConnector(input.connectorId);
    const ownerId = res.kind === "brand" ? res.brand.marketingOwnerUserId : null;
    if (res.kind === "brand" && ownerId) {
      const persona = await prisma.user.findFirst({
        where: { id: ownerId, ...usuarioRuteableWhere() },
        select: { id: true },
      });
      if (persona) return { userIds: [persona.id], via: "responsable_marca", detalle: res.brand.name };
    }
  }

  // 2. La gerencia de la plaza del contacto, con el mismo criterio que el Pond.
  if (input.plaza) {
    const gerencia = await gerenciaDeLaPlaza(input.plaza);
    if (gerencia.length > 0) return { userIds: gerencia, via: "gerencia_plaza", detalle: input.plaza };
  }

  // 3. Último recurso: los ADMIN que son personas.
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", ...usuarioRuteableWhere() },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (admins.length > 0) return { userIds: admins.map((a) => a.id), via: "admins", detalle: null };

  return { userIds: [], via: null, detalle: null };
}

function porQueTeLlega(via: ViaDelAviso, detalle: string | null): string {
  switch (via) {
    case "responsable_marca":
      return `te llega como responsable de la marca «${detalle}»`;
    case "gerencia_plaza":
      return `te llega como gerencia de ${detalle}`;
    case "admins":
      return "te llega como administrador";
  }
}

/**
 * Avisa de un hilo sin dueño (ver cabecera). Devuelve los ids a los que SÍ se les creó
 * aviso en esta llamada (vacío si todos ya tenían uno o no hay nadie). Nunca lanza.
 */
export async function avisarHiloSinDueno(input: {
  conversationId: string;
  connectorId: string | null;
  plaza: string | null;
  title: string;
  message: string;
  type: string;
}): Promise<string[]> {
  const link = `/inbox?c=${input.conversationId}`;
  try {
    const { userIds, via, detalle } = await destinatariosHiloSinDueno(input);
    if (userIds.length === 0 || !via) {
      console.warn(
        `[aviso-sin-dueno] conversación ${input.conversationId} en manos de un humano sin dueño y sin nadie a quien ` +
          `avisar (ni responsable de marca, ni gerencia de la plaza, ni ADMIN que sea persona)`,
      );
      return [];
    }

    const yaAvisados = await prisma.notification.findMany({
      where: {
        userId: { in: userIds },
        link,
        isRead: false,
        createdAt: { gte: new Date(Date.now() - VENTANA_DEDUP_AVISO_MS) },
      },
      select: { userId: true },
    });
    const ya = new Set(yaAvisados.map((n) => n.userId));
    const nuevos = userIds.filter((id) => !ya.has(id));
    if (nuevos.length === 0) return [];

    const message = `${input.message} · Nadie tiene este hilo: ${porQueTeLlega(via, detalle)}.`;
    await prisma.notification.createMany({
      data: nuevos.map((userId) => ({ userId, title: input.title, message, type: input.type, link })),
    });
    return nuevos;
  } catch (err) {
    console.error(`[aviso-sin-dueno] no se pudo avisar del hilo sin dueño ${input.conversationId}:`, err);
    return [];
  }
}
