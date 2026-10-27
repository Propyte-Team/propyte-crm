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

// Los valores llegan legibles («Ya mismo») o como código del formulario de Meta («ya_mismo»,
// «tres_meses»): el guion bajo se lee como espacio para que las mismas reglas cubran los dos.
function norm(v: unknown): string {
  return typeof v === "string"
    ? v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/_/g, " ").replace(/\s+/g, " ").trim()
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
  if (/ya mismo|right now|ahora|inmediat|immediate|de inmediato|^ya$/.test(s)) return "IMMEDIATE";
  if (/\b3\b|tres mes|3 mes|3 month|three month/.test(s)) return "THREE_TO_SIX_MONTHS";
  if (/proximo mes|next month|un mes|1 mes/.test(s)) return "ONE_TO_THREE_MONTHS";
  return undefined; // "Todavía no lo decidí" / "Not sure yet" → sin dato
}

// Presupuesto: nativo (ES=MDP→pesos ×1M, EN=USD tal cual). NO convierte (evita inflar por FX).
// La etiqueta original queda en custom; aquí solo derivamos números + moneda.
// Códigos de opción de los formularios de Meta (valor de `field_data`, ya con norm()). No traen
// moneda ni números legibles («menos 1 5» = menos de 1.5 MDP), así que van por tabla.
const BUDGET_CODES: Record<string, Pick<DerivedProfile, "budgetMin" | "budgetMax" | "budgetCurrency">> = {
  "less 50k": { budgetMax: 50_000, budgetCurrency: "USD" },
  "50k 150k": { budgetMin: 50_000, budgetMax: 150_000, budgetCurrency: "USD" },
  "150k 300k": { budgetMin: 150_000, budgetMax: 300_000, budgetCurrency: "USD" },
  "more 300k": { budgetMin: 300_000, budgetCurrency: "USD" },
  "menos 1 5": { budgetMax: 1_500_000, budgetCurrency: "MXN" },
  "rango 1 5 3": { budgetMin: 1_500_000, budgetMax: 3_000_000, budgetCurrency: "MXN" },
  "rango 3 6": { budgetMin: 3_000_000, budgetMax: 6_000_000, budgetCurrency: "MXN" },
  "mas 6": { budgetMin: 6_000_000, budgetCurrency: "MXN" },
};

function parseBudget(s: string): Pick<DerivedProfile, "budgetMin" | "budgetMax" | "budgetCurrency"> {
  if (!s) return {};
  if (BUDGET_CODES[s]) return { ...BUDGET_CODES[s] };
  const currency: DerivedProfile["budgetCurrency"] = /usd|dolar|dollar|dlls/.test(s)
    ? "USD"
    : /mdp|mxn|peso/.test(s)
      ? "MXN"
      : undefined;
  const mult = /mdp/.test(s) ? 1_000_000 : 1; // "MDP" = millones de pesos
  // Sufijo por número: «$50k a $150k USD» = miles; «$1.5 M a $3 M MXN» = millones.
  // El sufijo solo cuenta si no sigue otra letra: en «3.5mdp» la «m» es de «mdp», no de millones.
  const nums = [...s.matchAll(/(\d[\d.,]*)\s*(k(?![a-z])|m(?![a-z]))?/g)]
    .map(([, n, suf]) => {
      const v = parseFloat(n.replace(/,/g, ""));
      return suf === "k" ? v * 1_000 : suf === "m" ? v * 1_000_000 : v * mult;
    })
    .filter((n) => !isNaN(n));
  if (!nums.length) return {};
  const isLess = /menos|less|hasta|under|<|debajo/.test(s);
  const isMore = /mas |más|more|arriba|over|\+|>/.test(s);
  if (isLess) return { budgetMax: nums[0], budgetCurrency: currency };
  if (isMore) return { budgetMin: nums[0], budgetCurrency: currency };
  if (nums.length >= 2) return { budgetMin: nums[0], budgetMax: nums[1], budgetCurrency: currency };
  return { budgetMax: nums[0], budgetCurrency: currency };
}

// Llaves que se leen por campo: las cortas, las que Meta arma con la pregunta completa (ES y EN)
// y las columnas de real_estate_hub.meta_leads (`budget`, `urgency`, `acquisition`).
// Exportadas para que perfil-desde-hub.ts filtre en SQL por exactamente las mismas.
export const CLAVES_PERFIL = {
  interes: [
    "interes_principal", "buscas_invertir", "main_interest", "interest",
    "¿cuál_es_tu_interés_principal?", "what_is_your_main_interest_in_the_riviera_maya?",
  ],
  pago: [
    "forma_adquisicion", "payment", "acquire", "como_planeas_adquirir", "how_acquire", "acquisition",
    "¿cómo_planeas_adquirir_tu_propiedad?", "how_do_you_plan_to_acquire_your_property?",
  ],
  plazo: [
    "urgencia", "urgency", "timeline", "cuando",
    "¿con_qué_urgencia_quieres_comprar?", "how_urgently_do_you_want_to_buy?",
  ],
  presupuesto: [
    "presupuesto", "budget", "rango_presupuesto", "budget_range",
    "¿cuál_es_tu_rango_de_presupuesto_estimado?", "what_is_your_estimated_budget_range?",
  ],
} as const;

export function deriveInvestmentProfile(external: Record<string, unknown>): DerivedProfile {
  const out: DerivedProfile = {};
  const profile = mapInvestmentProfile(pick(external, [...CLAVES_PERFIL.interes]));
  if (profile) out.investmentProfile = profile;
  const payment = mapPayment(pick(external, [...CLAVES_PERFIL.pago]));
  if (payment) out.paymentMethod = payment;
  const timeline = mapTimeline(pick(external, [...CLAVES_PERFIL.plazo]));
  if (timeline) out.purchaseTimeline = timeline;
  const budget = parseBudget(pick(external, [...CLAVES_PERFIL.presupuesto]));
  Object.assign(out, budget);
  return out;
}
