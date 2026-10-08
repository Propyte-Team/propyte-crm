// Serializa el alta de un mismo contacto cuando llegan dos peticiones a la vez.
//
// El defecto (#844, caso real del 3-oct-2026): una persona nueva escribió dos mensajes
// por WhatsApp con 70 ms de diferencia. Cada mensaje es una petición de webhook
// distinta; las dos corrieron "¿ya existe este contacto?" antes de que la otra lo
// creara, las dos contestaron "no" y las dos hicieron contact.create — 6 ms de
// diferencia entre las dos altas. Resultado: dos fichas de la misma persona, cada una
// con su conversación y su bot, una en BOT y la otra escalada a HUMAN.
//
// Contact.phone no tiene restricción única (hay duplicados históricos y teléfonos
// vacíos de contactos que solo traen correo), así que la base no lo frena. Aquí se
// frena de otra forma: la petición que llega segunda ESPERA a que termine la primera
// y, al correr su búsqueda, ya ve el contacto creado.
//
// Cómo: un advisory lock de Postgres a nivel de TRANSACCIÓN (pg_advisory_xact_lock).
// Se suelta solo al terminar la transacción —con éxito o con error—, así que no puede
// quedar un candado huérfano, y funciona con el pooler de Supabase en modo
// transacción (uno de sesión, pg_advisory_lock, NO: la sesión no es de quien lo pide).
//
// `fn` recibe el cliente de la transacción y TODO lo que deba quedar serializado
// (la búsqueda y el alta) tiene que usarlo. No es un detalle estético: si `fn` usara el
// `prisma` global mientras la transacción tiene el candado agarrado, cada alta
// ocuparía dos conexiones a la vez, y con un pool chico (connection_limit=1 es común
// con pgbouncer) la segunda conexión nunca llegaría: el candado esperaría a `fn` y `fn`
// esperaría una conexión.
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";

/**
 * Corre `fn` con un candado exclusivo sobre `key`. Con `key` nulo (nada con qué
 * deduplicar) no hay nada que serializar: corre directo, sin transacción.
 *
 * El nombre del candado lleva prefijo para no chocar con otros usos de advisory locks
 * en la misma base. Se usa `hashtextextended(…, 0)` (bigint): el `hashtext` de 32 bits
 * da colisiones —inofensivas, solo serializan dos altas que no tenían por qué esperarse—
 * mucho más seguido.
 */
export async function withIntakeLock<T>(
  key: string | null,
  fn: (db: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!key) return fn(prisma);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${"contact-intake:" + key}, 0))`;
      return fn(tx);
    },
    // maxWait: cuánto esperar por una conexión; timeout: cuánto puede durar todo.
    // Una alta normal dura milisegundos; esto solo acota el peor caso para que una
    // petición colgada no deje a las demás esperando para siempre.
    { maxWait: 5_000, timeout: 15_000 },
  );
}

/**
 * Llave de serialización de un lead: el identificador con el que se deduplica. Una sola
 * llave por lead (la primera que exista) — el caso real es el mismo teléfono llegando
 * dos veces; serializar por CADA identificador a la vez exigiría ordenar candados para
 * no provocar bloqueos mutuos, y no hace falta para este defecto.
 */
export function intakeLockKey(ids: {
  phone?: string | null;
  messengerPsid?: string | null;
  instagramId?: string | null;
  email?: string | null;
}): string | null {
  return ids.phone || ids.messengerPsid || ids.instagramId || ids.email || null;
}
