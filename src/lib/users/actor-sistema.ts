/**
 * A nombre de quién queda lo que hace el sistema o el bot. Una sola definición.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO (2026-10-12). En la cronología de los contactos, las
 * respuestas del bot y las actividades de mensaje entrante salían hechas «por Audit Temp
 * (Claude)»: `audit-temp@propyte.local`, una cuenta ADMIN técnica que ninguna persona usa y
 * que sigue activa. La causa no estaba en un sitio: ocho flujos (respuesta del bot, inbound
 * de WhatsApp/IG/Messenger, SMS entrante, nota de origen por comentario, lead repetido,
 * clasificador, playbook y WhatsApp de workflows) elegían su propio respaldo con una
 * variante de `prisma.user.findFirst({ where: { role: "ADMIN", isActive: true } })`, sin
 * orden (Postgres devuelve la fila que quiera) y sin descontar el dominio técnico. Y cuando
 * el contacto SÍ tenía dueño, se firmaba con él aunque el dueño fuera
 * `agentes@propyte.local`, que hoy es dueño de la mayoría de los contactos vivos (#734).
 *
 * Aquí vivía antes `lib/activities/actor.ts` (`actorDeActividad`), con el BUG 2026-07-24:
 * un contacto sin asignar hacía que la actividad se creara con `userId = contact.id`, la FK
 * reventaba y se llevaba todo el pipeline posterior. Esa lección sigue en pie: esta función
 * devuelve `null` cuando no hay a quién atribuir, NUNCA se inventa un id. Un `null` cuesta
 * una actividad; un id equivocado cuesta la transacción entera.
 *
 * QUÉ DECIDE Y QUÉ NO. Solo el actor: el `userId` que se estampa en el mensaje del bot, en
 * la actividad del sistema o en la auditoría de un cambio automático. NO decide a quién se
 * avisa (notificaciones, escalamientos, tareas que alguien tiene que hacer) ni toca
 * `contact.assignedToId`: un contacto de `agentes@propyte.local` lo sigue siendo, solo deja
 * de «firmar» con esa cuenta.
 *
 * El orden, de más a menos cercano al contacto:
 *   a) el asesor asignado, si está activo y no es cuenta técnica;
 *   b) el responsable de marketing de la marca (`brands.marketingOwnerUserId`), con el mismo
 *      filtro. La marca sale de `brandId` si viene; si no, de la cuenta (`connectorId`); si
 *      no, de la cuenta del hilo (`conversationId`). Una cuenta sin marca no aporta nadie;
 *   c) el ADMIN activo y no técnico MÁS ANTIGUO (`createdAt` asc, `id` asc para desempatar):
 *      siempre el mismo, no el que Postgres devuelva primero ese día;
 *   d) `null`.
 * Y un e) que solo corre si el llamador lo pide (`ultimoRecurso`): la regla de antes, para
 * los flujos donde quedarse sin firma costaría algo más que una nota (ver `ActorOptions`).
 * «Activo y no técnico» es `usuarioRuteableWhere()` (workflows/ruteables.ts): la misma regla
 * que usa el reparto, no una tercera copia de ella.
 */
import type { PrismaClient } from "@prisma/client";
import prisma from "@/lib/db";
import { usuarioRuteableWhere } from "@/lib/workflows/ruteables";

export interface ActorInput {
  /** El asesor del contacto (`contact.assignedToId`). */
  assignedToId?: string | null;
  /** Marca explícita: gana sobre la cuenta y sobre el hilo. */
  brandId?: string | null;
  /** Cuenta (`lead_connectors`) por la que entró o sale el mensaje: aporta su marca. */
  connectorId?: string | null;
  /** Hilo, cuando no hay cuenta a mano: aporta la marca de la cuenta del hilo. */
  conversationId?: string | null;
}

/** Lo único que esta función lee. `PrismaClient` lo cumple; las pruebas pasan un doble. */
export type ActorDb = Pick<PrismaClient, "user" | "brand" | "leadConnector" | "conversation">;

/**
 * Memoria por petición. Se crea con `crearCacheDeActor()` y se pasa a cada llamada de un
 * mismo ciclo (p. ej. el lote de `runQueue`): el ADMIN de respaldo se consulta una vez por
 * lote y no una vez por acción. No es global a propósito: un caché de módulo seguiría
 * firmando con un ADMIN que alguien acaba de desactivar.
 */
export type ActorCache = Map<string, Promise<string | null>>;

export function crearCacheDeActor(): ActorCache {
  return new Map();
}

export interface ActorOptions {
  /** Cliente a usar (el `db` inyectado de classify/playbook). Por defecto, el de `@/lib/db`. */
  db?: ActorDb;
  cache?: ActorCache;
  /**
   * e) Solo para quien NO puede saltarse la acción por falta de firma: la respuesta del bot
   * al cliente y las escrituras de datos del bot (clasificador, playbook), donde un `null`
   * no cuesta una nota sino el mensaje o el dato. Si a–c no dan nadie, se vuelve a la regla
   * de antes —el asignado tal cual, o el ADMIN activo más antiguo aunque sea técnico— para
   * que este cambio jamás deje de hacer algo que antes se hacía. Con a–c vacíos no hay
   * ninguna persona a quien atribuir: mejor una firma técnica que perder lo demás. Las
   * notas de cronología (actividades de inbound, origen, lead repetido) NO lo piden: para
   * ellas un `null` solo cuesta la nota.
   */
  ultimoRecurso?: boolean;
}

/** P2021 = tabla inexistente, P2022 = columna inexistente: la migración aún no se aplicó. */
function esEsquemaFaltante(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

/**
 * Guarda la PROMESA, no el valor: dos llamadas simultáneas del mismo lote comparten la
 * consulta en vuelo. Si la consulta falla, se olvida, para que la siguiente lo reintente
 * en vez de heredar el error.
 */
function recordar(
  cache: ActorCache | undefined,
  clave: string,
  consulta: () => Promise<string | null>,
): Promise<string | null> {
  if (!cache) return consulta();
  const previa = cache.get(clave);
  if (previa) return previa;
  const promesa = consulta();
  cache.set(clave, promesa);
  promesa.catch(() => cache.delete(clave));
  return promesa;
}

/** a) Una persona concreta, si está activa y no es cuenta técnica. */
function personaValida(db: ActorDb, id: string, cache?: ActorCache): Promise<string | null> {
  return recordar(cache, `usuario:${id}`, async () => {
    const u = await db.user.findFirst({ where: { id, ...usuarioRuteableWhere() }, select: { id: true } });
    return u?.id ?? null;
  });
}

/**
 * b) El responsable de marketing de la marca, ya filtrado: una sola consulta por fuente,
 * con el filtro de persona dentro del `where` de la relación. La marca borrada no cuenta.
 *
 * Un error de lectura NO se propaga: la marca es un respaldo, y quedarse sin ella solo
 * significa caer al ADMIN. Igual que `resolveBrandForConnector`, la migración sin aplicar
 * se trata como «sin marca» sin hacer ruido.
 */
function responsableDeMarca(db: ActorDb, input: ActorInput, cache?: ActorCache): Promise<string | null> {
  const marcaConResponsable = { deletedAt: null, marketingOwner: { is: usuarioRuteableWhere() } };
  let clave: string;
  let consulta: () => Promise<string | null | undefined>;
  if (input.brandId) {
    const id = input.brandId;
    clave = `marca:${id}`;
    consulta = async () =>
      (
        await db.brand.findFirst({
          where: { id, ...marcaConResponsable },
          select: { marketingOwnerUserId: true },
        })
      )?.marketingOwnerUserId;
  } else if (input.connectorId) {
    const id = input.connectorId;
    clave = `cuenta:${id}`;
    consulta = async () =>
      (
        await db.leadConnector.findFirst({
          where: { id, brand: { is: marcaConResponsable } },
          select: { brand: { select: { marketingOwnerUserId: true } } },
        })
      )?.brand?.marketingOwnerUserId;
  } else if (input.conversationId) {
    const id = input.conversationId;
    clave = `hilo:${id}`;
    consulta = async () =>
      (
        await db.conversation.findFirst({
          where: { id, connector: { is: { brand: { is: marcaConResponsable } } } },
          select: { connector: { select: { brand: { select: { marketingOwnerUserId: true } } } } },
        })
      )?.connector?.brand?.marketingOwnerUserId;
  } else {
    return Promise.resolve(null);
  }
  return recordar(cache, clave, async () => {
    try {
      return (await consulta()) ?? null;
    } catch (err) {
      if (!esEsquemaFaltante(err)) {
        console.error(`[actor] no se pudo leer el responsable de la marca (${clave}); se sigue con el ADMIN:`, err);
      }
      return null;
    }
  });
}

/** c) El ADMIN activo y no técnico más antiguo. Determinista: mismo resultado cada vez. */
function adminMasAntiguo(db: ActorDb, cache?: ActorCache): Promise<string | null> {
  return recordar(cache, "admin", async () => {
    const u = await db.user.findFirst({
      where: { role: "ADMIN", ...usuarioRuteableWhere() },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    return u?.id ?? null;
  });
}

/** e) La regla de antes de este archivo, con orden determinista. Solo con `ultimoRecurso`. */
async function reglaAnterior(db: ActorDb, assignedToId: string | null | undefined): Promise<string | null> {
  if (assignedToId) return assignedToId;
  const u = await db.user.findFirst({
    where: { role: "ADMIN", isActive: true, deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return u?.id ?? null;
}

/**
 * El `userId` con que se firma una acción del sistema o del bot sobre un contacto.
 * Ver el orden (a–d, y e opcional) en la cabecera del archivo.
 *
 * Coste: cada paso es UNA consulta y solo corre si el anterior no dio a nadie. El caso
 * común —contacto con asesor de verdad— es una sola lectura por id.
 */
export async function resolveActorUserId(input: ActorInput, opts: ActorOptions = {}): Promise<string | null> {
  const db = opts.db ?? prisma;
  const { cache } = opts;

  if (input.assignedToId) {
    const asesor = await personaValida(db, input.assignedToId, cache);
    if (asesor) return asesor;
  }

  const responsable = await responsableDeMarca(db, input, cache);
  if (responsable) return responsable;

  const admin = await adminMasAntiguo(db, cache);
  if (admin) return admin;

  return opts.ultimoRecurso ? reglaAnterior(db, input.assignedToId) : null;
}
