// Registro de fusiones de contactos y su deshacer (E7 #977).
// Persistencia sin migración: SystemConfig, clave contacts.fusiones = lista acotada (las últimas
// MAX_FUSIONES), la más reciente primero. Cada registro guarda lo necesario para revertir:
// ids de cada relación movida al ganador y el valor previo de los campos que se le copiaron.
// Desde #903 la fusión suelta los ids de canal del perdedor (instagramId, messengerPsid,
// whatsappUserId) y pasa al ganador los que este no tenía. El registro guarda los originales del
// perdedor; al deshacer, primero se le quitan al ganador (si siguen como los dejó la fusión) y
// luego se devuelven al perdedor los que nadie más tenga ocupados.
import type { Prisma } from "@prisma/client";
import { IDS_DE_CANAL, type IdDeCanal } from "./archivar";

export const CLAVE_FUSIONES = "contacts.fusiones";
export const MAX_FUSIONES = 200;

// Mismas listas que mergeContacts (src/server/contacts-dedup.ts).
export const RELACIONES_N = ["deal", "activity", "walkIn", "message", "slaTimer", "connectorLeadLog", "conversionEvent", "shortlist", "contactFile"] as const;
export const RELACIONES_UNO = ["contactDossier", "adAttribution", "webBehavior", "conversation"] as const;

export interface RegistroFusion {
  id: string;
  fecha: string; // ISO
  actorId: string | null;
  survivorId: string;
  loserId: string;
  survivorNombre: string;
  loserNombre: string;
  /** relación -> ids de las filas que pasaron del perdedor al ganador */
  movidas: Record<string, string[]>;
  /** relaciones 1-a-1 que pasaron al ganador (el ganador no tenía) -> id de la fila */
  movidasUno: Record<string, string[]>;
  /** campo del ganador que se llenó -> { antes, despues } */
  campos: Record<string, { antes: unknown; despues: unknown }>;
  /** ids de canal que tenía el perdedor al fusionarse (la fusión se los quita) */
  idsCanalArchivado?: Partial<Record<IdDeCanal, string>>;
  deshechaEn?: string;
}

export type TxLike = {
  systemConfig: {
    findUnique: (args: { where: { key: string } }) => Promise<{ value: unknown } | null>;
    upsert: (args: { where: { key: string }; update: { value: Prisma.InputJsonValue }; create: { key: string; value: Prisma.InputJsonValue } }) => Promise<unknown>;
  };
};

export function leerFusiones(value: unknown): RegistroFusion[] {
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is RegistroFusion => !!r && typeof r === "object" && typeof (r as RegistroFusion).id === "string" && typeof (r as RegistroFusion).loserId === "string");
}

/** Agrega al inicio y recorta a MAX_FUSIONES. */
export function agregarFusion(lista: RegistroFusion[], nuevo: RegistroFusion): RegistroFusion[] {
  return [nuevo, ...lista].slice(0, MAX_FUSIONES);
}

export function nombreDe(c: { firstName?: string | null; lastName?: string | null }): string {
  return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre";
}

export async function guardarFusiones(tx: TxLike, lista: RegistroFusion[]): Promise<void> {
  const value = lista as unknown as Prisma.InputJsonValue;
  await tx.systemConfig.upsert({ where: { key: CLAVE_FUSIONES }, update: { value }, create: { key: CLAVE_FUSIONES, value } });
}

/** Se llama dentro de la transacción de mergeContacts. */
export async function registrarFusion(tx: TxLike, nuevo: RegistroFusion): Promise<void> {
  const fila = await tx.systemConfig.findUnique({ where: { key: CLAVE_FUSIONES } });
  await guardarFusiones(tx, agregarFusion(leerFusiones(fila?.value), nuevo));
}

// ---- Deshacer -------------------------------------------------------------

type Delegado = {
  updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
  count: (args: { where: Record<string, unknown> }) => Promise<number>;
};
export type TxDeshacer = TxLike & {
  contact: {
    findUnique: (args: { where: { id: string } }) => Promise<Record<string, unknown> | null>;
    findFirst: (args: { where: Record<string, unknown>; select?: Record<string, boolean> }) => Promise<Record<string, unknown> | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
} & Record<string, unknown>;

export type ResultadoDeshacer =
  | { ok: true; loserId: string; survivorId: string; idsNoDevueltos: IdDeCanal[] }
  | { error: string; status: number };

/**
 * Valida y revierte una fusión registrada. `tx` ya está dentro de una transacción.
 * Nunca pisa datos más nuevos: un campo del ganador solo se revierte si sigue valiendo lo que
 * puso la fusión; una fila solo vuelve al perdedor si sigue colgada del ganador.
 */
export async function deshacerFusionTx(tx: TxDeshacer, id: string): Promise<ResultadoDeshacer> {
  const fila = await tx.systemConfig.findUnique({ where: { key: CLAVE_FUSIONES } });
  const lista = leerFusiones(fila?.value);
  const reg = lista.find((r) => r.id === id);
  if (!reg) return { error: "Esa fusión no tiene registro para deshacer (es anterior a esta función)", status: 404 };
  if (reg.deshechaEn) return { error: "Esa fusión ya se deshizo", status: 409 };

  const loser = await tx.contact.findUnique({ where: { id: reg.loserId } });
  const survivor = await tx.contact.findUnique({ where: { id: reg.survivorId } });
  if (!loser || !survivor) return { error: "Uno de los contactos ya no existe; no se puede deshacer", status: 409 };
  if (survivor.deletedAt) return { error: "El contacto principal está archivado; restáuralo antes de deshacer la fusión", status: 409 };
  if (!loser.deletedAt || loser.mergedIntoId !== reg.survivorId) {
    return { error: "El contacto fusionado ya cambió de estado (restaurado o fusionado en otro); no se puede deshacer", status: 409 };
  }

  const d = (rel: string) => tx[rel] as Delegado;

  // 1. Relaciones N: solo las filas que siguen en el ganador.
  for (const [rel, ids] of Object.entries(reg.movidas)) {
    if (!ids?.length || !(RELACIONES_N as readonly string[]).includes(rel)) continue;
    await d(rel).updateMany({ where: { id: { in: ids }, contactId: reg.survivorId }, data: { contactId: reg.loserId } });
  }
  // 2. 1-a-1: devolver solo si el perdedor no tiene ya una.
  for (const [rel, ids] of Object.entries(reg.movidasUno)) {
    if (!ids?.length || !(RELACIONES_UNO as readonly string[]).includes(rel)) continue;
    const yaTiene = await d(rel).count({ where: { contactId: reg.loserId } });
    if (yaTiene === 0) await d(rel).updateMany({ where: { id: { in: ids }, contactId: reg.survivorId }, data: { contactId: reg.loserId } });
  }
  // 3. Campos del ganador que la fusión llenó.
  const revertir: Record<string, unknown> = {};
  for (const [campo, { antes, despues }] of Object.entries(reg.campos)) {
    if (esIgual(survivor[campo], despues)) revertir[campo] = antes ?? null;
  }
  if (Object.keys(revertir).length) await tx.contact.update({ where: { id: reg.survivorId }, data: revertir });
  // 4. Restaurar al perdedor, con sus ids de canal si nadie más los ocupa (índice único).
  const devolver: Record<string, string> = {};
  const idsNoDevueltos: IdDeCanal[] = [];
  for (const campo of IDS_DE_CANAL) {
    const valor = reg.idsCanalArchivado?.[campo];
    if (!valor) continue;
    const ocupado = await tx.contact.findFirst({ where: { [campo]: valor, id: { not: reg.loserId } }, select: { id: true } });
    if (ocupado) idsNoDevueltos.push(campo);
    else devolver[campo] = valor;
  }
  await tx.contact.update({ where: { id: reg.loserId }, data: { deletedAt: null, mergedIntoId: null, ...devolver } });
  // 5. Marcar el registro.
  const nueva = lista.map((r) => (r.id === id ? { ...r, deshechaEn: new Date().toISOString() } : r));
  await guardarFusiones(tx, nueva);
  return { ok: true, loserId: reg.loserId, survivorId: reg.survivorId, idsNoDevueltos };
}

function esIgual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
  return norm(a) === norm(b);
}
