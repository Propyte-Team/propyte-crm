import prisma from "@/lib/db";
import { buildDuplicateGroups } from "@/lib/contacts/duplicates";
import { setChangeSource } from "@/lib/audit/change-context";

export interface DupGroupContact {
  id: string; firstName: string; lastName: string;
  email: string | null; phone: string; createdAt: Date;
  assignedTo: { name: string | null } | null;
  _count: { deals: number; activities: number };
}

export async function findDuplicateGroups(): Promise<DupGroupContact[][]> {
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null, mergedIntoId: null },
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true,
      assignedTo: { select: { name: true } },
      _count: { select: { deals: true, activities: true } },
    },
  });
  const byId = new Map(contacts.map((c) => [c.id, c as DupGroupContact]));
  const groups = buildDuplicateGroups(contacts.map((c) => ({ id: c.id, email: c.email, phone: c.phone })));
  return groups
    .map((ids) => ids.map((id) => byId.get(id)!).filter(Boolean))
    .sort((a, b) => b.length - a.length);
}

const N_RELATIONS = ["deal", "activity", "walkIn", "message", "slaTimer", "connectorLeadLog", "conversionEvent", "shortlist"] as const;
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
    if (Object.keys(enrich).length) await tx.contact.update({ where: { id: input.survivorId }, data: enrich });

    await tx.contact.update({ where: { id: input.loserId }, data: { mergedIntoId: input.survivorId, deletedAt: new Date() } });

    return { survivorId: input.survivorId };
  });
}
