"use server";

// ============================================================
// Server Actions: Cotizaciones, Planes de Pago y Documentos
// ============================================================

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";
import { addMonths, startOfDay } from "date-fns";
import {
  createQuoteSchema,
  updateQuoteSchema,
  paymentPlanSchema,
  updateInstallmentSchema,
  primerMensaje,
} from "@/lib/validations/quote";
import { buildInstallmentPlan, computeFinalPrice } from "@/lib/quotes/pricing";

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

export async function createQuote(input: unknown) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const parsed = createQuoteSchema.safeParse(input);
  if (!parsed.success) return { error: primerMensaje(parsed.error) };
  const data = parsed.data;

  const finalPrice = computeFinalPrice(data.listPrice, data.discountPct);

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
      discountPct: data.discountPct,
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

export async function updateQuote(id: string, input: unknown) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const parsed = updateQuoteSchema.safeParse(input);
  if (!parsed.success) return { error: primerMensaje(parsed.error) };
  const data = parsed.data;

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

  // Recalcular precio final si cambió listPrice o discountPct (AUD-20260903-D03:
  // en centavos, para que el plan de pagos que se genere después pueda cerrar).
  if (data.listPrice !== undefined || data.discountPct !== undefined) {
    const newListPrice = data.listPrice ?? Number(existing.listPrice);
    const newDiscountPct = data.discountPct ?? Number(existing.discountPct);
    updateData.listPrice = newListPrice;
    updateData.discountPct = newDiscountPct;
    updateData.finalPrice = computeFinalPrice(newListPrice, newDiscountPct);
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

export async function createPaymentPlan(quoteId: string, input: unknown) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const parsed = paymentPlanSchema.safeParse(input);
  if (!parsed.success) return { error: primerMensaje(parsed.error) };
  const data = parsed.data;

  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, deletedAt: null },
    include: { paymentPlan: true },
  });
  if (!quote) return { error: "Cotización no encontrada" };
  if (quote.paymentPlan) return { error: "Esta cotización ya tiene un plan de pago" };

  const finalPrice = Number(quote.finalPrice);
  const { downPaymentPct, deliveryPaymentPct, monthsCount } = data;

  // AUD-20260903-D03: el reparto se hace en centavos enteros y el residuo se carga en
  // la última mensualidad, para que Σ parcialidades === finalPrice.
  const reparto = buildInstallmentPlan({
    finalPrice,
    downPaymentPct,
    deliveryPaymentPct,
    monthsCount,
  });
  const { downPaymentAmount, deliveryAmount, monthlyAmount, monthlyAmounts } = reparto;

  const startDate = data.startDate ? startOfDay(data.startDate) : startOfDay(new Date());

  // Generar schedules: enganche (#1) + mensualidades + entrega (#n+2)
  const scheduleData: Array<{
    number: number;
    dueDate: Date;
    amount: number;
  }> = [];

  // #1 — enganche
  scheduleData.push({ number: 1, dueDate: startDate, amount: downPaymentAmount });

  // mensualidades
  monthlyAmounts.forEach((amount, i) => {
    scheduleData.push({
      number: i + 2,
      dueDate: addMonths(startDate, i + 1),
      amount,
    });
  });

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

export async function updateInstallment(id: string, input: unknown) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  // AUD-20260903-D09 (mitad de validación): `paidAmount` llegaba crudo, así que un
  // texto reventaba con 500 y un negativo se guardaba y descuadraba la cobranza. La
  // verificación de que la parcialidad pertenezca a un negocio del usuario es del
  // helper de acceso por objeto (Paso 3), no de este cambio.
  const parsed = updateInstallmentSchema.safeParse(input);
  if (!parsed.success) return { error: primerMensaje(parsed.error) };
  const data = parsed.data;

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
