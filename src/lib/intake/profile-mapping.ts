// Normaliza las respuestas de los formularios de leads (Meta/TikTok/Google, ES/EN) a los
// enums canónicos del CRM (Perfil de Inversión). Camino A: el CRM mantiene su taxonomía y
// aquí traducimos por palabra clave (tolerante a idioma y redacción). Lo que no mapea con
// confianza se deja vacío (NUNCA un valor inválido) — el dato crudo siempre queda en custom.

export interface DerivedProfile {
  investmentProfile?: "END_USER" | "INVESTOR_RENTAL" | "INVESTOR_FLIP" | "INVESTOR_LAND" | "MIXED";
  paymentMethod?: "CONTADO" | "CREDITO_HIPOTECARIO" | "FINANCIAMIENTO_DIRECTO" | "MIXTO";
  purchaseTimeline?: "IMMEDIATE" | "ONE_TO_THREE_MONTHS" | "THREE_TO_SIX_MONTHS" | "SIX_PLUS_MONTHS";
  budgetMin?: number;
  budgetMax?: number;
  budgetCurrency?: "MXN" | "USD";
}

function norm(v: unknown): string {
  return typeof v === "string"
    ? v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()
    : "";
}

// Toma el primer valor presente de varias llaves posibles (idiomas/variantes).
function pick(external: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const s = norm(external[k]);
    if (s) return s;
  }
  return "";
}

function mapInvestmentProfile(s: string): DerivedProfile["investmentProfile"] {
  if (!s) return undefined;
  if (/vivir|to live|para vivir|habitar/.test(s)) return "END_USER";
  if (/inversion|investment|renta|rental|plusval|capital gain|vacation rental/.test(s)) return "INVESTOR_RENTAL";
  if (/opcion|option|viendo|looking|explor/.test(s)) return "MIXED";
  return undefined;
}

function mapPayment(s: string): DerivedProfile["paymentMethod"] {
  if (!s) return undefined;
  if (/contado|cash|de contado/.test(s)) return "CONTADO";
  if (/financ|bank|banco|credit|crédit|hipotec|mortgage/.test(s)) return "CREDITO_HIPOTECARIO";
  return undefined; // "No tengo claro" / "Not sure" → sin dato
}

function mapTimeline(s: string): DerivedProfile["purchaseTimeline"] {
  if (!s) return undefined;
  if (/ya mismo|right now|ahora|inmediat|immediate|de inmediato/.test(s)) return "IMMEDIATE";
  if (/\b3\b|tres mes|3 mes|3 month|three month/.test(s)) return "THREE_TO_SIX_MONTHS";
  if (/proximo mes|next month|un mes|1 mes/.test(s)) return "ONE_TO_THREE_MONTHS";
  return undefined; // "Todavía no lo decidí" / "Not sure yet" → sin dato
}

// Presupuesto: nativo (ES=MDP→pesos ×1M, EN=USD tal cual). NO convierte (evita inflar por FX).
// La etiqueta original queda en custom; aquí solo derivamos números + moneda.
function parseBudget(s: string): Pick<DerivedProfile, "budgetMin" | "budgetMax" | "budgetCurrency"> {
  if (!s) return {};
  const currency: DerivedProfile["budgetCurrency"] = /usd|dolar|dollar|dlls/.test(s)
    ? "USD"
    : /mdp|mxn|peso/.test(s)
      ? "MXN"
      : undefined;
  const mult = /mdp/.test(s) ? 1_000_000 : 1; // "MDP" = millones de pesos
  const nums = (s.match(/[\d][\d.,]*/g) ?? [])
    .map((n) => parseFloat(n.replace(/,/g, "")))
    .filter((n) => !isNaN(n))
    .map((n) => n * mult);
  if (!nums.length) return {};
  const isLess = /menos|less|hasta|under|<|debajo/.test(s);
  const isMore = /mas |más|more|arriba|over|\+|>/.test(s);
  if (isLess) return { budgetMax: nums[0], budgetCurrency: currency };
  if (isMore) return { budgetMin: nums[0], budgetCurrency: currency };
  if (nums.length >= 2) return { budgetMin: nums[0], budgetMax: nums[1], budgetCurrency: currency };
  return { budgetMax: nums[0], budgetCurrency: currency };
}

export function deriveInvestmentProfile(external: Record<string, unknown>): DerivedProfile {
  const out: DerivedProfile = {};
  const profile = mapInvestmentProfile(pick(external, ["interes_principal", "buscas_invertir", "main_interest", "interest"]));
  if (profile) out.investmentProfile = profile;
  const payment = mapPayment(pick(external, ["forma_adquisicion", "payment", "acquire", "como_planeas_adquirir"]));
  if (payment) out.paymentMethod = payment;
  const timeline = mapTimeline(pick(external, ["urgencia", "urgency", "timeline", "cuando"]));
  if (timeline) out.purchaseTimeline = timeline;
  const budget = parseBudget(pick(external, ["presupuesto", "budget", "rango_presupuesto", "budget_range"]));
  Object.assign(out, budget);
  return out;
}
