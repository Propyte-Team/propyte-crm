// src/lib/mcp/auth.ts
import { timingSafeEqual } from "crypto";
import prisma from "@/lib/db";

export function checkBearer(header: string | null, expected: string): boolean {
  if (!expected) return false;
  if (!header?.startsWith("Bearer ")) return false;
  const got = header.slice(7).trim(); // gotcha conocido: \n trailing
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Qué puede hacer quien trae este header.
 *
 * `solo_lectura` no es «un poco menos que escritura»: es la diferencia entre una
 * credencial que consulta y una que puede crear reglas de automatización, conectores y
 * campos. Hasta ahora había UN token para las dos cosas, así que cualquier sistema que
 * quisiera solo leer —el tablero de mejoras, por ejemplo— tenía que portar la llave que
 * también escribe.
 */
export type NivelDeAcceso = "escritura" | "solo_lectura" | "ninguno";

/**
 * Resuelve el nivel a partir del header y de los dos tokens configurados.
 *
 * Función pura: no mira el método ni responde nada. Quién convierte un nivel en un 401
 * o un 403 es el route, y así esto se prueba sin levantar Next.
 *
 * 🚨 Si los dos tokens son IGUALES, el de lectura se ignora. Un despliegue que copie el
 * mismo valor en las dos variables estaría concediendo escritura bajo un nombre que dice
 * «readonly», que es peor que no tener la variable: la lectura del `.env` diría que hay
 * separación de privilegios donde no la hay.
 */
export function nivelDeAcceso(
  header: string | null,
  tokens: { escritura: string; soloLectura: string },
): NivelDeAcceso {
  if (checkBearer(header, tokens.escritura)) return "escritura";
  if (tokens.soloLectura && tokens.soloLectura === tokens.escritura) return "ninguno";
  if (checkBearer(header, tokens.soloLectura)) return "solo_lectura";
  return "ninguno";
}

let cachedUserId: string | null = null;
const SYSTEM_EMAIL = "mcp@propyte.local";

/** id del usuario-sistema MCP para AuditLog. Lanza si no existe (correr seed). */
export async function getMcpUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const u = await prisma.user.findUnique({ where: { email: SYSTEM_EMAIL }, select: { id: true } });
  if (!u) throw new Error("MCP system user missing: run scripts/seed-mcp-user.ts");
  cachedUserId = u.id;
  return u.id;
}
