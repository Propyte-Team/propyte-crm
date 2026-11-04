import { randomUUID } from "crypto";
import prisma from "@/lib/db";
import { buildDuplicateGroups, type DuplicateMatchType } from "@/lib/contacts/duplicates";
import { setChangeSource } from "@/lib/audit/change-context";
import { nombreDe, registrarFusion, type RegistroFusion, type TxLike } from "@/lib/contacts/fusiones";

export interface DupGroupContact {
  id: string; firstName: string; lastName: string;
  email: string | null; phone: string; createdAt: Date;
  assignedTo: { name: string | null } | null;
  instagramId: string | null; messengerPsid: string | null;
  _count: { deals: number; activities: number };
}

export interface DupGroupResult {
  matchType: DuplicateMatchType;
  contacts: DupGroupContact[];
}

export async function findDuplicateGroups(): Promise<DupGroupResult[]> {
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null, mergedIntoId: null },
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true,
      assignedTo: { select: { name: true } },
      instagramId: true, messengerPsid: true,
      _count: { select: { deals: true, activities: true } },
    },
  });
  const byId = new Map(contacts.map((c) => [c.id, c as DupGroupContact]));
  const groups = buildDuplicateGroups(
    contacts.map((c) => ({ id: c.id, email: c.email, phone: c.phone, firstName: c.firstName, lastName: c.lastName }))
  );
  return groups
    .map((g) => ({
      matchType: g.matchType,
      contacts: g.ids.map((id) => byId.get(id)!).filter(Boolean),
    }))
    .sort((a, b) => {
      if (a.matchType !== b.matchType) return a.matchType === "strong" ? -1 : 1;
      return b.contacts.length - a.contacts.length;
    });
}

// #917: contactFile — los CV del contacto fusionado pasan al que queda.
const N_RELATIONS = ["deal", "activity", "walkIn", "message", "slaTimer", "connectorLeadLog", "conversionEvent", "shortlist", "contactFile"] as const;
const ONE_TO_ONE = ["contactDossier", "adAttribution", "webBehavior", "conversation"] as const;

export async function mergeContacts(input: { survivorId: string; loserId: string; actorId?: string | null }):
  Promise<{ error: string } | { survivorId: string }> {
  if (input.survivorId === input.loserId) return { error: "No se puede fusionar un contacto consigo mismo" };

  return prisma.$transaction(async (tx) => {
    await setChangeSource(tx, { source: "merge", actorId: input.actorId ?? null });
    const survivor = await tx.contact.findFirst({ where: { id: input.survivorId, deletedAt: null, mergedIntoId: null } });
    const loser = await tx.contact.findFirst({ where: { id: input.loserId, deletedAt: null, mergedIntoId: null } });
    if (!survivor || !loser) return { error: "Uno de los contactos no existe o ya fue fusionado/borrado" };

    const movidas: Record<string, string[]> = {};
    const movidasUno: Record<string, string[]> = {};
    for (const rel of N_RELATIONS) {
      const filas: Array<{ id: string }> = await (tx as any)[rel].findMany({ where: { contactId: input.loserId }, select: { id: true } }); // #977: para deshacer
      if (filas.length) movidas[rel] = filas.map((f) => f.id);
      await (tx as any)[rel].updateMany({ where: { contactId: input.loserId }, data: { contactId: input.survivorId } });
    }
    for (const rel of ONE_TO_ONE) {
      const survivorHas = await (tx as any)[rel].count({ where: { contactId: input.survivorId } });
      if (survivorHas === 0) {
        const filas: Array<{ id: string }> = await (tx as any)[rel].findMany({ where: { contactId: input.loserId }, select: { id: true } });
        if (filas.length) movidasUno[rel] = filas.map((f) => f.id);
        await (tx as any)[rel].updateMany({ where: { contactId: input.loserId }, data: { contactId: input.survivorId } });
      }
    }
    const enrich: Record<string, unknown> = {};
    if (!survivor.email && loser.email) enrich.email = loser.email;
    if (!survivor.secondaryPhone && loser.secondaryPhone) enrich.secondaryPhone = loser.secondaryPhone;
    if (!survivor.leadSourceDetail && loser.leadSourceDetail) enrich.leadSourceDetail = loser.leadSourceDetail;
    if (!survivor.originalCreatedAt) {
      enrich.originalCreatedAt = loser.originalCreatedAt ?? (loser.createdAt < survivor.createdAt ? loser.createdAt : survivor.createdAt);
    }
    if (Object.keys(enrich).length) await tx.contact.update({ where: { id: input.survivorId }, data: enrich });
    const campos: RegistroFusion["campos"] = {};
    for (const k of Object.keys(enrich)) campos[k] = { antes: (survivor as Record<string, unknown>)[k] ?? null, despues: enrich[k] };

    await tx.contact.update({ where: { id: input.loserId }, data: { mergedIntoId: input.survivorId, deletedAt: new Date() } });
    await registrarFusion(tx as unknown as TxLike, {
      id: randomUUID(), fecha: new Date().toISOString(), actorId: input.actorId ?? null,
      survivorId: input.survivorId, loserId: input.loserId,
      survivorNombre: nombreDe(survivor), loserNombre: nombreDe(loser),
      movidas, movidasUno, campos,
    });

    return { survivorId: input.survivorId };
  });
}
