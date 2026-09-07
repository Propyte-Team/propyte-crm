// Aritmética de dinero de las cotizaciones y planes de pago (§T3).
//
// AUD-20260903-D03: el prorrateo se hacía en punto flotante y cada mensualidad se
// guardaba redondeada por separado (Decimal(14,2)), así que la suma de las
// parcialidades NO coincidía con finalPrice: 900,000 entre 7 daba 128,571.43 × 7 =
// 900,000.01, y en planes de 48-60 meses el desfase llegaba a decenas de pesos. El
// estado de cuenta del cliente nunca cerraba.
//
// Regla: todo se calcula en CENTAVOS ENTEROS y el residuo se carga en la última
// mensualidad. La invariante que sostiene este módulo es
//     enganche + Σ mensualidades + entrega === finalPrice
// y está cubierta por pricing.test.ts.

const CENTS = 100;

/** Pesos → centavos enteros, sin arrastrar el ruido del punto flotante. */
export function toCents(amount: number): number {
  // (2.675 * 100) es 267.49999999999997 en IEEE-754; el toFixed lo limpia antes de redondear.
  return Math.round(Number((amount * CENTS).toFixed(4)));
}

/** Centavos enteros → pesos. */
export function fromCents(cents: number): number {
  return cents / CENTS;
}

/** Precio final ya redondeado al centavo. `discountPct` viene acotado 0-100 por zod. */
export function computeFinalPrice(listPrice: number, discountPct = 0): number {
  const listCents = toCents(listPrice);
  const finalCents = Math.round(Number((listCents * (1 - discountPct / 100)).toFixed(4)));
  return fromCents(finalCents);
}

export interface InstallmentPlanInput {
  finalPrice: number;
  downPaymentPct: number;
  monthsCount: number;
  deliveryPaymentPct?: number;
}

export interface InstallmentPlan {
  /** Enganche (parcialidad #1). */
  downPaymentAmount: number;
  /** Pago contra entrega (última parcialidad), 0 si no aplica. */
  deliveryAmount: number;
  /** Mensualidad nominal: la que se muestra en la cotización. */
  monthlyAmount: number;
  /** Una por mes, en orden. La última absorbe el residuo del prorrateo. */
  monthlyAmounts: number[];
  /** Suma de todas las parcialidades. Siempre igual a finalPrice. */
  total: number;
}

/**
 * Reparte `finalPrice` en enganche + mensualidades + entrega sin perder ni inventar
 * centavos. Cuando no hay mensualidades, el residuo va a la entrega y, si tampoco la
 * hay, al enganche: alguna parcialidad tiene que cargarlo para que la suma cierre.
 */
export function buildInstallmentPlan(input: InstallmentPlanInput): InstallmentPlan {
  const { finalPrice, downPaymentPct, monthsCount } = input;
  const deliveryPaymentPct = input.deliveryPaymentPct ?? 0;

  if (downPaymentPct < 0 || deliveryPaymentPct < 0 || monthsCount < 0) {
    throw new RangeError("Los porcentajes y el número de meses no pueden ser negativos");
  }
  if (downPaymentPct + deliveryPaymentPct > 100) {
    throw new RangeError("El enganche y el pago contra entrega no pueden sumar más de 100%");
  }

  const finalCents = toCents(finalPrice);
  let downCents = Math.round(Number((finalCents * (downPaymentPct / 100)).toFixed(4)));
  let deliveryCents = Math.round(Number((finalCents * (deliveryPaymentPct / 100)).toFixed(4)));

  let remaining = finalCents - downCents - deliveryCents;

  // Con porcentajes que suman 100 los dos redondeos pueden pasarse un centavo.
  if (remaining < 0) {
    if (deliveryCents > 0) deliveryCents += remaining;
    else downCents += remaining;
    remaining = 0;
  }

  let baseCents = 0;
  const monthlyCents: number[] = [];
  if (monthsCount > 0) {
    baseCents = Math.floor(remaining / monthsCount);
    for (let i = 0; i < monthsCount; i++) monthlyCents.push(baseCents);
    monthlyCents[monthsCount - 1] += remaining - baseCents * monthsCount;
  } else if (remaining > 0) {
    if (deliveryPaymentPct > 0) deliveryCents += remaining;
    else downCents += remaining;
  }

  const totalCents =
    downCents + deliveryCents + monthlyCents.reduce((acc, c) => acc + c, 0);

  return {
    downPaymentAmount: fromCents(downCents),
    deliveryAmount: fromCents(deliveryCents),
    monthlyAmount: fromCents(baseCents),
    monthlyAmounts: monthlyCents.map(fromCents),
    total: fromCents(totalCents),
  };
}
