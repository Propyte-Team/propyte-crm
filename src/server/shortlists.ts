import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { getHubUnit } from "@/lib/hub/client";
import { generateShortlistToken } from "@/lib/shortlists/token";
import { buildUnitSnapshot, nextSortOrder, shouldMarkOpened } from "@/lib/shortlists/snapshot";
import {
  verificarAccesoANegocio,
  tieneAccesoTotal,
  FUERA_DE_ALCANCE,
} from "@/lib/rbac/deal-access";

// #711 · AUD-20260903 S-04. Ninguna de las funciones de mutación recibía al usuario, así
// que cualquiera con sesión podía marcar como enviada la propuesta de otro asesor —con el
// enlace público ya en manos del cliente—, renombrarla, alterar las notas de sus unidades
// o borrarla. El id de la propuesta que viene en la URL tampoco se usaba al tocar un
// ítem: bastaba el id del ítem.

export interface UsuarioShortlist {
  id: string;
  role: string;
  plaza: string;
}

/**
 * Quién puede tocar una propuesta: quien la creó, dirección, o quien tenga alcance sobre
 * el negocio al que cuelga. Devuelve la propuesta cuando el acceso es válido.
 */
export async function verificarAccesoAShortlist(shortlistId: string, user: UsuarioShortlist) {
  const shortlist = await prisma.shortlist.findFirst({
    where: { id: shortlistId, deletedAt: null },
    select: { id: true, createdById: true, dealId: true },
  });
  if (!shortlist) return { ok: false as const, error: FUERA_DE_ALCANCE };

  if (shortlist.createdById === user.id || tieneAccesoTotal(user.role)) {
    return { ok: true as const, shortlist };
  }
  if (shortlist.dealId) {
    const acceso = await verificarAccesoANegocio(shortlist.dealId, user);
    if (acceso.ok) return { ok: true as const, shortlist };
  }
  return { ok: false as const, error: FUERA_DE_ALCANCE };
}

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

export async function addItem(
  input: { shortlistId: string; hubUnitId: string; note?: string | null },
  user: UsuarioShortlist
) {
  const acceso = await verificarAccesoAShortlist(input.shortlistId, user);
  if (!acceso.ok) return { error: acceso.error };

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

export async function removeItem(itemId: string, shortlistId: string, user: UsuarioShortlist) {
  const acceso = await verificarAccesoAShortlist(shortlistId, user);
  if (!acceso.ok) return { error: acceso.error };

  // `deleteMany` con las dos condiciones: un ítem de otra propuesta no se borra ni por
  // error ni a propósito, aunque se adivine su id.
  const { count } = await prisma.shortlistItem.deleteMany({ where: { id: itemId, shortlistId } });
  if (count === 0) return { error: FUERA_DE_ALCANCE };
  return { ok: true as const };
}

export async function updateItemNote(
  itemId: string,
  shortlistId: string,
  note: string | null,
  user: UsuarioShortlist
) {
  const acceso = await verificarAccesoAShortlist(shortlistId, user);
  if (!acceso.ok) return { error: acceso.error };

  const { count } = await prisma.shortlistItem.updateMany({
    where: { id: itemId, shortlistId },
    data: { note },
  });
  if (count === 0) return { error: FUERA_DE_ALCANCE };
  return { item: await prisma.shortlistItem.findUnique({ where: { id: itemId } }) };
}

export async function reorderItems(orderedIds: string[], shortlistId: string, user: UsuarioShortlist) {
  const acceso = await verificarAccesoAShortlist(shortlistId, user);
  if (!acceso.ok) return { error: acceso.error };

  await prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.shortlistItem.update({ where: { id }, data: { sortOrder: idx } })
    )
  );
  return { ok: true as const };
}

export async function updateShortlistTitle(id: string, title: string, user: UsuarioShortlist) {
  const acceso = await verificarAccesoAShortlist(id, user);
  if (!acceso.ok) return { error: acceso.error };

  const shortlist = await prisma.shortlist.update({ where: { id }, data: { title } });
  return { shortlist };
}

export async function sendShortlist(id: string, user: UsuarioShortlist) {
  const acceso = await verificarAccesoAShortlist(id, user);
  if (!acceso.ok) return { error: acceso.error };

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

export async function softDeleteShortlist(id: string, user: UsuarioShortlist) {
  const acceso = await verificarAccesoAShortlist(id, user);
  if (!acceso.ok) return { error: acceso.error };

  await prisma.shortlist.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true as const };
}
