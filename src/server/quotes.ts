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
import { verificarAccesoANegocio, FUERA_DE_ALCANCE } from "@/lib/rbac/deal-access";

// #711: todo lo de este archivo cuelga de un negocio, y hasta ahora ninguna de estas
// funciones comprobaba de QUIÉN es ese negocio: bastaba con tener sesión y adivinar un
// id para leer o editar las cotizaciones y los documentos de toda la empresa. El helper
// es el mismo control que ya existía en /api/deals/[id]; lo que faltaba era aplicarlo.

/** Acceso al negocio dueño del registro. Devuelve el error listo para el `{ error }`. */
async function accesoAlNegocio(
  dealId: string,
  user: { id: string; role: string; plaza: string },
  modo: "ver" | "editar" = "editar"
) {
  const acceso = await verificarAccesoANegocio(dealId, user, modo);
  return acceso.ok ? null : { error: FUERA_DE_ALCANCE };
}


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

  // Devolver una lista vacía escondería el intento: mejor que la ruta responda 404.
  const acceso = await verificarAccesoANegocio(dealId, session.user, "ver");
  if (!acceso.ok) throw new Error(FUERA_DE_ALCANCE);

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

  const sinAcceso = await accesoAlNegocio(data.dealId, session.user);
  if (sinAcceso) return sinAcceso;

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

  const sinAcceso = await accesoAlNegocio(existing.dealId, session.user);
  if (sinAcceso) return sinAcceso;

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

  const sinAcceso = await accesoAlNegocio(quote.dealId, session.user);
  if (sinAcceso) return sinAcceso;

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

  // AUD-20260903-D09: `paidAmount` llegaba crudo (arreglado en el PR #43) y además
  // NADIE comprobaba de quién era la parcialidad, así que cualquier usuario marcaba
  // PAGADA cualquier parcialidad de cualquier negocio adivinando el id. #711 cierra
  // esa mitad: se resuelve la cadena parcialidad → plan → cotización → negocio.
  const parsed = updateInstallmentSchema.safeParse(input);
  if (!parsed.success) return { error: primerMensaje(parsed.error) };
  const data = parsed.data;

  const existing = await prisma.paymentSchedule.findUnique({
    where: { id },
    include: { plan: { select: { quote: { select: { dealId: true } } } } },
  });
  if (!existing) return { error: "Parcialidad no encontrada" };

  const sinAcceso = await accesoAlNegocio(existing.plan.quote.dealId, session.user);
  if (sinAcceso) return sinAcceso;

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

  // Lo más sensible del CRM: INE, comprobantes de ingresos, contratos firmados.
  const acceso = await verificarAccesoANegocio(dealId, session.user, "ver");
  if (!acceso.ok) throw new Error(FUERA_DE_ALCANCE);

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

  const sinAcceso = await accesoAlNegocio(dealId, session.user);
  if (sinAcceso) return sinAcceso;

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

  const sinAcceso = await accesoAlNegocio(existing.dealId, session.user);
  if (sinAcceso) return sinAcceso;

  await prisma.dealDocument.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return { success: true };
}
