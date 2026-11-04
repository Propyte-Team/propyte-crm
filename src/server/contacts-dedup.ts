import prisma from "@/lib/db";
import { buildDuplicateGroups, type DuplicateMatchType } from "@/lib/contacts/duplicates";
import { setChangeSource } from "@/lib/audit/change-context";
import { datosDeArchivado, idsQuePasanAlQueQueda } from "@/lib/contacts/archivar";

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

    for (const rel of N_RELATIONS) {
      await (tx as any)[rel].updateMany({ where: { contactId: input.loserId }, data: { contactId: input.survivorId } });
    }
    for (const rel of ONE_TO_ONE) {
      const survivorHas = await (tx as any)[rel].count({ where: { contactId: input.survivorId } });
      if (survivorHas === 0) {
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
    // #903: los ids de canal del fusionado (Instagram, Messenger, WhatsApp) pasan al que queda si
    // este no tiene el suyo. Antes se quedaban en el archivado: cuando la persona volvía a escribir
    // por ese canal nadie la encontraba (el intake solo mira vivos) y su alta chocaba con el id
    // ocupado. Primero se archiva al fusionado soltando sus ids y DESPUÉS se le dan al que queda:
    // en el orden contrario, los dos tendrían el mismo id un instante y el índice único lo rechaza.
    Object.assign(enrich, idsQuePasanAlQueQueda(survivor, loser));

    await tx.contact.update({
      where: { id: input.loserId },
      data: { mergedIntoId: input.survivorId, ...datosDeArchivado() },
    });

    if (Object.keys(enrich).length) await tx.contact.update({ where: { id: input.survivorId }, data: enrich });

    return { survivorId: input.survivorId };
  });
}
