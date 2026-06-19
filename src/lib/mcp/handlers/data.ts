// src/lib/mcp/handlers/data.ts
import { z } from "zod";
import prisma from "@/lib/db";

// ── helpers ───────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number) { return Math.min(Math.max(n, min), max); }

// =====================================================================
// CONTACTS
// =====================================================================

const searchContactsSchema = z.object({
  search:     z.string().optional(),
  temperature: z.string().optional(),
  type:       z.string().optional(),
  assignedTo: z.string().optional(),
  plaza:      z.string().optional(),
  page:       z.coerce.number().int().min(1).default(1),
  pageSize:   z.coerce.number().int().min(1).default(20), // clamped to 100 below
});

export async function searchContacts(query: unknown) {
  const d = searchContactsSchema.parse(query);
  const pageSize = clamp(d.pageSize, 1, 100);
  const skip     = (d.page - 1) * pageSize;

  const where: Record<string, unknown> = { deletedAt: null };

  if (d.temperature) where.temperature  = d.temperature;
  if (d.type)        where.contactType  = d.type;
  if (d.assignedTo)  where.assignedToId = d.assignedTo;

  if (d.search) {
    where.OR = [
      { firstName: { contains: d.search, mode: "insensitive" } },
      { lastName:  { contains: d.search, mode: "insensitive" } },
      { email:     { contains: d.search, mode: "insensitive" } },
      { phone:     { contains: d.search.replace(/\D/g, "") || d.search } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.contact.findMany({
      where: where as never,
      take:  pageSize,
      skip,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.contact.count({ where: where as never }),
  ]);

  return { data, total, page: d.page, pageSize };
}

export async function getContactById(id: string) {
  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      deals:      { where: { deletedAt: null }, select: { id: true, stage: true, estimatedValue: true, dealType: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 10, select: { activityType: true, subject: true, createdAt: true } },
    },
  });
  if (!contact) throw new Error("Contacto no encontrado");
  return contact;
}

// =====================================================================
// DEALS
// =====================================================================

const listDealsSchema = z.object({
  stage:         z.string().optional(),
  assignedToId:  z.string().optional(),
  developmentId: z.string().optional(),
  page:          z.coerce.number().int().min(1).default(1),
  pageSize:      z.coerce.number().int().min(1).default(20), // clamped to 100 below
});

export async function listDeals(query: unknown) {
  const d = listDealsSchema.parse(query);
  const pageSize = clamp(d.pageSize, 1, 100);
  const skip     = (d.page - 1) * pageSize;

  const where: Record<string, unknown> = { deletedAt: null };
  if (d.stage)         where.stage         = d.stage;
  if (d.assignedToId)  where.assignedToId  = d.assignedToId;
  if (d.developmentId) where.developmentId = d.developmentId;

  const [data, total] = await Promise.all([
    prisma.deal.findMany({
      where: where as never,
      take:  pageSize,
      skip,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.deal.count({ where: where as never }),
  ]);

  return { data, total, page: d.page, pageSize };
}

export async function getDealById(id: string) {
  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      quotes:  { where: { deletedAt: null } },
    },
  });
  if (!deal) throw new Error("Deal no encontrado");
  return deal;
}

// =====================================================================
// QUOTES
// =====================================================================

const listQuotesSchema = z.object({
  dealId: z.string(),
});

export async function listQuotes(query: unknown) {
  const d = listQuotesSchema.parse(query);
  return prisma.quote.findMany({
    where: { dealId: d.dealId },
    include: {
      paymentPlan: {
        include: { schedules: true },
      },
    },
  });
}
