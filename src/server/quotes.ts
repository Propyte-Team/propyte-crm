"use server";

// ============================================================
// Server Actions: Cotizaciones, Planes de Pago y Documentos
// ============================================================

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";
import { addMonths, startOfDay } from "date-fns";

// --------------- helpers ---------------

function serializeQuote(q: any): any {
  return {
    ...q,
    listPrice: Number(q.listPrice),
    discountPct: Number(q.discountPct),
    finalPrice: Number(q.finalPrice),
    fxRate: q.fxRate ? Number(q.fxRate) : null,
    paymentPlan: q.paymentPlan ? serializePlan(q.paymentPlan) : null,
  };
}

function serializePlan(p: any): any {
  return {
    ...p,
    downPaymentPct: Number(p.downPaymentPct),
    downPaymentAmount: Number(p.downPaymentAmount),
    monthlyAmount: Number(p.monthlyAmount),
    deliveryPaymentPct: Number(p.deliveryPaymentPct),
    deliveryAmount: Number(p.deliveryAmount),
    schedules: (p.schedules ?? []).map((s: any) => ({
      ...s,
      amount: Number(s.amount),
      paidAmount: s.paidAmount ? Number(s.paidAmount) : null,
    })),
  };
}

// --------------- getQuotesByDeal ---------------

export async function getQuotesByDeal(dealId: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const quotes = await prisma.quote.findMany({
    where: { dealId, deletedAt: null },
    include: {
      createdBy: { select: { id: true, name: true } },
      paymentPlan: {
        include: { schedules: { orderBy: { number: "asc" } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return quotes.map(serializeQuote);
}

// --------------- createQuote ---------------

export async function createQuote(data: {
  dealId: string;
  hubUnitId?: string | null;
  currency: "MXN" | "USD";
  listPrice: number;
  discountPct?: number;
  scheme: "CONTADO" | "FINANCIAMIENTO_DIRECTO" | "CREDITO_BANCARIO" | "MIXTO";
  notes?: string | null;
  expiresAt?: Date | null;
  fxRate?: number | null;
}) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  if (!data.dealId) return { error: "dealId es requerido" };
  if (!data.listPrice || data.listPrice <= 0) return { error: "listPrice debe ser positivo" };

  const discountPct = data.discountPct ?? 0;
  const finalPrice = data.listPrice * (1 - discountPct / 100);

  // T3.1: congelar snapshot de la unidad del Hub al emitir (fuente + precio + fecha).
  let unitSnapshot: Record<string, unknown> = {};
  if (data.hubUnitId) {
    const { getHubUnit } = await import("@/lib/hub/client");
    const u = await getHubUnit(data.hubUnitId);
    if (u) unitSnapshot = { ...u, snapshotAt: new Date().toISOString(), source: "hub" };
  }

  const quote = await prisma.quote.create({
    data: {
      dealId: data.dealId,
      createdById: session.user.id,
      hubUnitId: data.hubUnitId ?? null,
      currency: data.currency,
      listPrice: data.listPrice,
      discountPct,
      finalPrice,
      fxRate: data.fxRate ?? null,
      scheme: data.scheme,
      notes: data.notes ?? null,
      expiresAt: data.expiresAt ?? null,
      unitSnapshot: unitSnapshot as never,
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      paymentPlan: { include: { schedules: { orderBy: { number: "asc" } } } },
    },
  });

  return { quote: serializeQuote(quote) };
}

// --------------- updateQuote ---------------

export async function updateQuote(
  id: string,
  data: Partial<{
    hubUnitId: string | null;
    currency: "MXN" | "USD";
    listPrice: number;
    discountPct: number;
    scheme: "CONTADO" | "FINANCIAMIENTO_DIRECTO" | "CREDITO_BANCARIO" | "MIXTO";
    notes: string | null;
    expiresAt: Date | null;
    fxRate: number | null;
    status: "DRAFT" | "SENT" | "OPENED" | "ACCEPTED" | "EXPIRED" | "CANCELLED";
  }>
) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.quote.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return { error: "Cotización no encontrada" };

  const updateData: Prisma.QuoteUpdateInput = {};
  if (data.hubUnitId !== undefined) updateData.hubUnitId = data.hubUnitId;
  if (data.currency !== undefined) updateData.currency = data.currency;
  if (data.scheme !== undefined) updateData.scheme = data.scheme;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt;
  if (data.fxRate !== undefined) updateData.fxRate = data.fxRate;
  if (data.status !== undefined) updateData.status = data.status;

  // Recalcular precio final si cambió listPrice o discountPct
  const newListPrice = data.listPrice ?? Number(existing.listPrice);
  const newDiscountPct = data.discountPct ?? Number(existing.discountPct);
  if (data.listPrice !== undefined || data.discountPct !== undefined) {
    updateData.listPrice = newListPrice;
    updateData.discountPct = newDiscountPct;
    updateData.finalPrice = newListPrice * (1 - newDiscountPct / 100);
  }

  const quote = await prisma.quote.update({
    where: { id },
    data: updateData,
    include: {
      createdBy: { select: { id: true, name: true } },
      paymentPlan: { include: { schedules: { orderBy: { number: "asc" } } } },
    },
  });

  return { quote: serializeQuote(quote) };
}

// --------------- createPaymentPlan ---------------

export async function createPaymentPlan(
  quoteId: string,
  data: {
    downPaymentPct: number;
    monthsCount: number;
    deliveryPaymentPct?: number;
    startDate?: Date;
  }
) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, deletedAt: null },
    include: { paymentPlan: true },
  });
  if (!quote) return { error: "Cotización no encontrada" };
  if (quote.paymentPlan) return { error: "Esta cotización ya tiene un plan de pago" };

  const finalPrice = Number(quote.finalPrice);
  const downPaymentPct = data.downPaymentPct;
  const deliveryPaymentPct = data.deliveryPaymentPct ?? 0;
  const monthsCount = data.monthsCount;

  const downPaymentAmount = finalPrice * (downPaymentPct / 100);
  const deliveryAmount = finalPrice * (deliveryPaymentPct / 100);
  const remainingForMonthly = finalPrice - downPaymentAmount - deliveryAmount;
  const monthlyAmount = monthsCount > 0 ? remainingForMonthly / monthsCount : 0;

  const startDate = data.startDate ? startOfDay(data.startDate) : startOfDay(new Date());

  // Generar schedules: enganche (#0) + mensualidades + entrega (#n+1)
  const scheduleData: Array<{
    number: number;
    dueDate: Date;
    amount: number;
  }> = [];

  // #1 — enganche
  scheduleData.push({ number: 1, dueDate: startDate, amount: downPaymentAmount });

  // mensualidades
  for (let i = 0; i < monthsCount; i++) {
    scheduleData.push({
      number: i + 2,
      dueDate: addMonths(startDate, i + 1),
      amount: monthlyAmount,
    });
  }

  // entrega (si aplica)
  if (deliveryPaymentPct > 0) {
    scheduleData.push({
      number: monthsCount + 2,
      dueDate: addMonths(startDate, monthsCount + 1),
      amount: deliveryAmount,
    });
  }

  const plan = await prisma.paymentPlan.create({
    data: {
      quoteId,
      downPaymentPct,
      downPaymentAmount,
      monthsCount,
      monthlyAmount,
      deliveryPaymentPct,
      deliveryAmount,
      schedules: {
        create: scheduleData.map((s) => ({
          number: s.number,
          dueDate: s.dueDate,
          amount: s.amount,
          status: "PENDIENTE",
        })),
      },
    },
    include: { schedules: { orderBy: { number: "asc" } } },
  });

  return { plan: serializePlan(plan) };
}

// --------------- updateInstallment ---------------

export async function updateInstallment(
  id: string,
  data: {
    status?: "PENDIENTE" | "PAGADA" | "VENCIDA" | "CONDONADA";
    paidAt?: Date | null;
    paidAmount?: number | null;
    notes?: string | null;
  }
) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.paymentSchedule.findUnique({ where: { id } });
  if (!existing) return { error: "Parcialidad no encontrada" };

  const updateData: Prisma.PaymentScheduleUpdateInput = {};
  if (data.status !== undefined) updateData.status = data.status;
  if (data.paidAt !== undefined) updateData.paidAt = data.paidAt;
  if (data.paidAmount !== undefined) updateData.paidAmount = data.paidAmount;
  if (data.notes !== undefined) updateData.notes = data.notes;

  // Auto-set paidAt when marking as PAGADA
  if (data.status === "PAGADA" && !data.paidAt) {
    updateData.paidAt = new Date();
  }

  const schedule = await prisma.paymentSchedule.update({
    where: { id },
    data: updateData,
  });

  return {
    schedule: {
      ...schedule,
      amount: Number(schedule.amount),
      paidAmount: schedule.paidAmount ? Number(schedule.paidAmount) : null,
    },
  };
}

// --------------- getDocumentsByDeal ---------------

export async function getDocumentsByDeal(dealId: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const docs = await prisma.dealDocument.findMany({
    where: { dealId, deletedAt: null },
    include: { uploadedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return docs;
}

// --------------- addDocument ---------------

export async function addDocument(
  dealId: string,
  data: {
    type:
      | "KYC"
      | "CONTRATO_ENVIADO"
      | "CONTRATO_FIRMADO"
      | "COMPROBANTE_ENGANCHE"
      | "RECIBO"
      | "COMPROBANTE_DOMICILIO"
      | "OTRO";
    name: string;
    url: string;
  }
) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  if (!data.name?.trim()) return { error: "El nombre del documento es requerido" };
  if (!data.url?.trim()) return { error: "La URL del documento es requerida" };

  const doc = await prisma.dealDocument.create({
    data: {
      dealId,
      type: data.type,
      name: data.name.trim(),
      url: data.url.trim(),
      uploadedById: session.user.id,
    },
    include: { uploadedBy: { select: { id: true, name: true } } },
  });

  return { doc };
}

// --------------- deleteDocument ---------------

export async function deleteDocument(id: string) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.dealDocument.findUnique({ where: { id } });
  if (!existing) return { error: "Documento no encontrado" };

  await prisma.dealDocument.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return { success: true };
}
