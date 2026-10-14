// ¿Esta cuenta es el WhatsApp propio de un asesor? (2026-10-14, coexistencia PR 2)
//
// Existe como pieza aparte porque la pregunta la hacen sitios que no deben arrastrar el resto de
// la coexistencia: el bot (bot-respond.ts), el envío con autoría de bot (twilio/whatsapp.ts) y el
// webhook. La respuesta decide si algo automático puede hablar por ese número, así que FALLA
// CERRADO: si no se puede leer la cuenta, se trata como de asesor (callar es mejor que contestar
// con el bot desde el teléfono de una persona). Mismo criterio que la marca «no disponible» de
// lib/brands/resolve.ts.
import prisma from "@/lib/db";

/** P2021 = tabla inexistente, P2022 = columna inexistente: la migración aún no se aplicó. */
function isMissingSchema(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function isAdvisorLine(connectorId: string | null | undefined): Promise<boolean> {
  if (!connectorId) return false; // número global: nunca es de asesor, y no cuesta consulta
  try {
    const c = await prisma.leadConnector.findUnique({ where: { id: connectorId }, select: { scope: true } });
    return c?.scope === "ADVISOR";
  } catch (err) {
    // Sin la columna no puede existir ninguna cuenta de asesor.
    if (isMissingSchema(err)) return false;
    console.error("[whatsapp-coex] no se pudo leer el alcance de la cuenta; se trata como de asesor", connectorId);
    return true;
  }
}

/**
 * Cuenta de asesor de este número en CUALQUIER estado —pausada, en error o borrada—. La usa el
 * webhook cuando el número no tiene cuenta activa: sin esto, los mensajes de un asesor que pausó o
 * borró su conexión en el CRM (pero sigue conectado en Meta) entrarían por el camino del «número
 * sin registrar», que da de alta a cualquiera que escriba — o sea, sus chats personales. Lanza si
 * no se puede leer: el llamador decide (el webhook descarta, por privacidad).
 */
export async function findAdvisorLineByPhoneNumberId(phoneNumberId: string): Promise<{ id: string } | null> {
  return prisma.leadConnector.findFirst({
    where: { provider: "WHATSAPP", scope: "ADVISOR", config: { path: ["phoneNumberId"], equals: phoneNumberId } },
    select: { id: true },
  });
}
