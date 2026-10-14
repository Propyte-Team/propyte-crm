/**
 * La gerencia de una plaza: a quién se le avisa cuando algo no tiene dueño.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO (2026-10-14, #858). Esta consulta vivía solo dentro de
 * `sendToPond` (routing.ts): el lead que el reparto no pudo asignar avisa a la gerencia de
 * su plaza. La #858 necesita EXACTAMENTE la misma gente para otro aviso —una conversación que
 * el bot pasó a un humano y nadie la tiene—, y una segunda copia del `findMany` es el
 * defecto que este tablero ya encontró tres veces (#715 A-03, #730, #682). Quién es «mando»
 * sigue saliendo de `mandoWhere()` (ruteables.ts); aquí solo se le pone la plaza.
 *
 * Lleva `@/lib/db` a propósito, a diferencia de `ruteables.ts`, que se mantiene sin imports
 * para que la lea la puerta de revisión.
 */
import prisma from "@/lib/db";
import { mandoWhere } from "./ruteables";

/**
 * Ids de la gerencia (GERENTE, DIRECTOR, ADMIN; activos y no técnicos) de `plaza`.
 * Con `plaza` null no se recorta: es toda la gerencia, que es lo que el Pond siempre hizo
 * con un lead sin plaza.
 */
export async function gerenciaDeLaPlaza(plaza: string | null): Promise<string[]> {
  const managers = await prisma.user.findMany({
    where: { ...mandoWhere(), ...(plaza ? { plaza: plaza as never } : {}) },
    select: { id: true },
  });
  return managers.map((m) => m.id);
}
