// Validaciones zod de cotizaciones y planes de pago (§T3).
//
// AUD-20260903-D03: estas rutas eran las únicas del módulo comercial sin zod
// (contacts, deals y activities sí lo usan). `POST /api/quotes` pasaba el body crudo,
// así que {"listPrice":1000000,"discountPct":-500} guardaba un precio final de
// 6,000,000 y un descuento de 150 lo dejaba en -500,000, con parcialidades negativas.
// Los enums libres reventaban en Prisma como 500 opaco en vez de 400.
import { z } from "zod";

export const QUOTE_CURRENCIES = ["MXN", "USD"] as const;
export const QUOTE_SCHEMES = [
  "CONTADO",
  "FINANCIAMIENTO_DIRECTO",
  "CREDITO_BANCARIO",
  "MIXTO",
] as const;
export const QUOTE_STATUSES = [
  "DRAFT",
  "SENT",
  "OPENED",
  "ACCEPTED",
  "EXPIRED",
  "CANCELLED",
] as const;

// Quote.listPrice / finalPrice son Decimal(14,2): 12 enteros + 2 decimales.
const MONTO_MAX = 9_999_999_999.99;

const monto = z
  .number({ invalid_type_error: "El monto debe ser un número" })
  .finite()
  .positive("El monto debe ser mayor a cero")
  .max(MONTO_MAX, "El monto excede el máximo permitido");

const porcentaje = z
  .number({ invalid_type_error: "El porcentaje debe ser un número" })
  .finite()
  .min(0, "El porcentaje no puede ser negativo")
  .max(100, "El porcentaje no puede ser mayor a 100");

const fechaOpcional = z.union([z.coerce.date(), z.null()]).optional();

export const createQuoteSchema = z.object({
  dealId: z.string().min(1, "dealId es requerido"),
  hubUnitId: z.string().min(1).nullish(),
  currency: z.enum(QUOTE_CURRENCIES, { errorMap: () => ({ message: "Moneda inválida" }) }),
  listPrice: monto,
  discountPct: porcentaje.default(0),
  scheme: z.enum(QUOTE_SCHEMES, { errorMap: () => ({ message: "Esquema de pago inválido" }) }),
  notes: z.string().max(5000).nullish(),
  expiresAt: fechaOpcional,
  fxRate: z.number().finite().positive("El tipo de cambio debe ser positivo").nullish(),
});

export const updateQuoteSchema = z.object({
  hubUnitId: z.string().min(1).nullish(),
  currency: z.enum(QUOTE_CURRENCIES, { errorMap: () => ({ message: "Moneda inválida" }) }).optional(),
  listPrice: monto.optional(),
  discountPct: porcentaje.optional(),
  scheme: z.enum(QUOTE_SCHEMES, { errorMap: () => ({ message: "Esquema de pago inválido" }) }).optional(),
  notes: z.string().max(5000).nullish(),
  expiresAt: fechaOpcional,
  fxRate: z.number().finite().positive("El tipo de cambio debe ser positivo").nullish(),
  status: z.enum(QUOTE_STATUSES, { errorMap: () => ({ message: "Estatus inválido" }) }).optional(),
});

export const paymentPlanSchema = z
  .object({
    downPaymentPct: porcentaje,
    monthsCount: z
      .number({ invalid_type_error: "El número de meses debe ser un número" })
      .int("El número de meses debe ser entero")
      .min(0, "El número de meses no puede ser negativo")
      .max(600, "El número de meses no puede pasar de 600"),
    deliveryPaymentPct: porcentaje.default(0),
    startDate: z.coerce.date().optional(),
  })
  .refine((d) => d.downPaymentPct + d.deliveryPaymentPct <= 100, {
    message: "El enganche y el pago contra entrega no pueden sumar más de 100%",
    path: ["downPaymentPct"],
  });

export const updateInstallmentSchema = z.object({
  status: z.enum(["PENDIENTE", "PAGADA", "VENCIDA", "CONDONADA"], {
    errorMap: () => ({ message: "Estatus de parcialidad inválido" }),
  }).optional(),
  paidAt: fechaOpcional,
  paidAmount: z.union([monto, z.literal(0), z.null()]).optional(),
  notes: z.string().max(5000).nullish(),
});

/**
 * Primer mensaje de error de un ZodError, para devolverlo como `{ error }` — que es el
 * contrato que las rutas de cotizaciones ya traducen a un 400.
 */
export function primerMensaje(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos";
}

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;
export type PaymentPlanInput = z.infer<typeof paymentPlanSchema>;
export type UpdateInstallmentInput = z.infer<typeof updateInstallmentSchema>;
