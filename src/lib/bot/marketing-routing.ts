// Ruteo de propuestas de marketing / comerciales hacia la persona responsable.
//
// Caso real (3-oct-2026): alguien escribió por WhatsApp para ofrecer servicios de
// marketing ("quiero darles a conocer nuestra marca…"). No es comprador, así que el bot
// no tenía guion: pidió una confirmación al cliente Y escaló en el mismo turno. La
// conversación quedó en HUMAN sin responsable (el contacto no tenía asesor), no salió
// ninguna notificación de "el bot te pasó una conversación" y la respuesta del cliente
// se quedó sin contestar. Decisión de Luis (2026-10-08): las propuestas de marketing se
// redirigen SIEMPRE a Luis Flores.
//
// Vive en su propio módulo (y no en claude.ts) para que el token y el resolvedor se
// puedan importar desde bot-respond.ts sin depender del cliente de Claude.
import prisma from "@/lib/db";

/** Token que el modelo agrega al final de su mensaje cuando la persona NO es comprador y
 * viene a ofrecer marketing/publicidad/servicios. Distinto de [ESCALAR] a propósito:
 * "[ESCALAR]" NO es subcadena de "[ESCALAR_MARKETING]" (el corchete cierra después de la R),
 * así que un `includes` de uno nunca dispara por el otro. */
export const ESCALATE_MARKETING_TOKEN = "[ESCALAR_MARKETING]";

/** Clave de system_config con el id del usuario que recibe estas conversaciones. */
export const MARKETING_OWNER_KEY = "marketing_escalation_user_id";
/** Respaldo: el administrador propietario (hoy, Luis Flores) — ver server/admin.ts. */
const ADMIN_OWNER_KEY = "admin_owner_user_id";

async function readUserIdConfig(key: string): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key } }).catch(() => null);
  const value = row?.value;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Id del usuario al que se redirigen las propuestas de marketing, o null si no hay
 * ninguno válido (en cuyo caso el escalamiento se comporta como antes).
 *
 * Primero la clave dedicada `marketing_escalation_user_id` (para poder cambiar de
 * responsable sin tocar código); si no existe, el administrador propietario. Solo cuenta
 * si el usuario existe, está activo y no está eliminado: mandarle la conversación a una
 * cuenta desactivada sería repetir el problema original (nadie se entera).
 *
 * `preferredUserId` (2026-10-09, marcas del agente): el responsable de marketing de la marca
 * de la conversación. Si está activo gana sobre la cadena de siempre; si no (null, inactivo
 * o eliminado) se cae a ella como si no se hubiera pasado.
 */
export async function getMarketingOwnerId(preferredUserId?: string | null): Promise<string | null> {
  const candidates = [
    preferredUserId ?? null,
    await readUserIdConfig(MARKETING_OWNER_KEY),
    await readUserIdConfig(ADMIN_OWNER_KEY),
  ].filter((id): id is string => !!id);

  for (const id of candidates) {
    const user = await prisma.user
      .findFirst({ where: { id, isActive: true, deletedAt: null }, select: { id: true } })
      .catch(() => null);
    if (user) return user.id;
  }
  return null;
}
