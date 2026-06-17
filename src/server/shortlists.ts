import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { getHubUnit } from "@/lib/hub/client";
import { generateShortlistToken } from "@/lib/shortlists/token";
import { buildUnitSnapshot, nextSortOrder, shouldMarkOpened } from "@/lib/shortlists/snapshot";

export async function createShortlist(input: {
  contactId: string;
  dealId?: string | null;
  createdById: string;
  title?: string;
}) {
  const shortlist = await prisma.shortlist.create({
    data: {
      token: generateShortlistToken(),
      contactId: input.contactId,
      dealId: input.dealId ?? null,
      createdById: input.createdById,
      ...(input.title ? { title: input.title } : {}),
    },
  });
  return { shortlist };
}

export async function addItem(input: {
  shortlistId: string;
  hubUnitId: string;
  note?: string | null;
}) {
  const unit = await getHubUnit(input.hubUnitId);
  if (!unit) return { error: "La unidad no existe en el Hub" as const };

  const existing = await prisma.shortlistItem.findMany({
    where: { shortlistId: input.shortlistId },
    select: { sortOrder: true },
  });

  const item = await prisma.shortlistItem.create({
    data: {
      shortlistId: input.shortlistId,
      hubUnitId: input.hubUnitId,
      snapshot: buildUnitSnapshot(unit) as unknown as Prisma.InputJsonValue,
      note: input.note ?? null,
      sortOrder: nextSortOrder(existing),
    },
  });
  return { item };
}

export async function removeItem(itemId: string) {
  await prisma.shortlistItem.delete({ where: { id: itemId } });
  return { ok: true as const };
}

export async function updateItemNote(itemId: string, note: string | null) {
  const item = await prisma.shortlistItem.update({ where: { id: itemId }, data: { note } });
  return { item };
}

export async function reorderItems(orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.shortlistItem.update({ where: { id }, data: { sortOrder: idx } })
    )
  );
  return { ok: true as const };
}

export async function updateShortlistTitle(id: string, title: string) {
  const shortlist = await prisma.shortlist.update({ where: { id }, data: { title } });
  return { shortlist };
}

export async function sendShortlist(id: string) {
  const shortlist = await prisma.shortlist.update({
    where: { id },
    data: { status: "SENT", sentAt: new Date() },
  });
  return { shortlist };
}

export async function getShortlistsFor(filter: { contactId?: string; dealId?: string }) {
  return prisma.shortlist.findMany({
    where: {
      deletedAt: null,
      ...(filter.contactId ? { contactId: filter.contactId } : {}),
      ...(filter.dealId ? { dealId: filter.dealId } : {}),
    },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      _count: { select: { views: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getShortlistByToken(token: string) {
  return prisma.shortlist.findFirst({
    where: { token, deletedAt: null },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      contact: { select: { firstName: true, lastName: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });
}

export async function recordView(shortlistId: string, userAgent?: string | null) {
  const sl = await prisma.shortlist.findUnique({
    where: { id: shortlistId },
    select: { openedAt: true, status: true },
  });
  await prisma.shortlistView.create({ data: { shortlistId, userAgent: userAgent ?? null } });
  if (sl && shouldMarkOpened(sl)) {
    await prisma.shortlist.update({
      where: { id: shortlistId },
      data: { openedAt: new Date(), ...(sl.status === "SENT" ? { status: "OPENED" } : {}) },
    });
  }
  return { ok: true as const };
}

export async function softDeleteShortlist(id: string) {
  await prisma.shortlist.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true as const };
}
