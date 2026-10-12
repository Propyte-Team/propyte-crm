// Inicios fijos de las notas internas que deja el bot (2026-10-10 y 2026-10-12): sirven para
// buscarlas. Módulo sin dependencias a propósito: lo importan send-failure.ts (que escribe las
// notas) y unregistered-account.ts (que las lee para el panel de leads huérfanos) sin arrastrar
// Prisma, y las pruebas que simulan send-failure no se quedan sin el prefijo.

/** Inicio fijo de las notas de rechazo de Meta. */
export const BOT_SEND_REJECTED_PREFIX = "Meta rechazó la respuesta del bot";

/** Inicio fijo de las notas de silencio del agente (2026-10-12). */
export const BOT_SILENCE_PREFIX = "El agente no contestó";
