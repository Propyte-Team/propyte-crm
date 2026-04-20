/**
 * Blacklist de nombres que NO son desarrolladores reales.
 *
 * Incluye:
 *  - Portales/fuentes de scraping (el mismo portal puesto como developer)
 *  - Brokers, agencias inmobiliarias, comercializadores
 *  - Patrones genéricos ("Real Estate", "Properties", "Realty", etc.)
 *
 * El Robot 01 NO debe crear un Propyte_desarrollador para estos nombres.
 * Si un developer_name matchea esta lista, se descarta (id_desarrollador = NULL).
 *
 * Marcas permitidas (whitelist): "Propyte", "Avica" — nunca se bloquean.
 */

// ─── WHITELIST: nunca bloquear ────────────────────────────────
const ALLOWED_BRANDS = [
  "propyte",
  "avica",
];

// ─── NOMBRES EXACTOS CONOCIDOS ────────────────────────────────
// Nombres que sabemos que son brokers/agencias, no desarrolladores.
// Se comparan en lowercase contra el developer_name normalizado.
const EXACT_BLACKLIST = new Set([
  // — Fuentes / portales (el mismo scraping source) —
  "plalla real estate",
  "luumo real estate",
  "llumo real estate",
  "maya ocean",
  "noval properties",
  "propiedades cancún",
  "propiedades cancun",
  "caribe luxury homes",
  "goodlers",

  // — Brokers / comercializadores conocidos —
  "concepto master broker",
  "foro master broker",
  "gh máster broker",
  "gh master broker",
  "intorno master broker",
  "kapua master broker",
  "mudarseamerida.com",

  // — Agencias / inmobiliarias detectadas —
  "tulum real estate",
  "tresor real estate",
  "zazil house real estate",
  "tribu real estate",
  "mexico real estate group",
  "nimbos realty",
  "on time realty",
  "rona realty",
  "sarah real estate",
  "select realty mexico",
  "selecta real estate",
  "sur selecto real estate",
  "the agency riviera maya",
  "tsalach real estate",
  "vrico real estate",
  "white rock real estate",
  "asha realty",
  "be living real estate",
  "blau kaan real estate",
  "caribbean properties mx",
  "caribbean real estate",
  "coco & lum real estate",
  "costa realty group mexico",
  "delilahmex luxury properties",
  "desur real estate",
  "dreambuilt luxury real estate",
  "ed real estate inovation",
  "evoke real estate group",
  "galena realty",
  "globalty real estate",
  "kaaura real estate & management",
  "pim real estate",
  "puerto aventuras real estate",
  "riverant real estate & law",
  "wa luxury properties",
  "zepto realty & construction",
  "limón inmobiliaria",
  "sisol soluciones inmobiliarias",
  "adoquin inmobiliaria",

  // — Grupos de inversión / consultoras —
  "top investments",
  "max properties",
  "cielo maya properties",
  "be journey investment",
  "mya investment group",
  "nobs investment group",
  "play investments",
  "home and investment",
  "alquimia investments",
  "immo investments",
  "ibrokers",
]);

// ─── PATRONES REGEX ───────────────────────────────────────────
// Si el developer_name contiene alguno de estos patrones → es broker/agencia.
// Se evalúan contra el nombre en lowercase.
const PATTERN_BLACKLIST: RegExp[] = [
  /\breal\s*estate\b/,
  /\brealty\b/,
  /\bproperties\b/,
  /\bbroker\b/,
  /\bmaster\s*broker\b/,
  /\binmobiliaria\b/,
  /\bbienes\s*ra[ií]ces\b/,
  /\bconsulting\b/,
  /\badvisors?\b/,
  /\bagency\b/,
  /\bagencia\b/,
  /\bsales\s*center\b/,
  /\binvestment\s*(group)?\b/,
  /\binvestments?\b/,
  /\bluxury\s*properties\b/,
  /\bsoluciones\s*inmobiliarias\b/,
];

/**
 * Verifica si un developer_name está en la whitelist.
 * Nombres con "Propyte" o "Avica" nunca se bloquean.
 */
function isWhitelisted(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return ALLOWED_BRANDS.some((brand) => lower.includes(brand));
}

/**
 * Verifica si un developer_name es un broker/agencia/fuente (NO un desarrollador real).
 *
 * @returns true si el nombre DEBE ser descartado (es broker/agencia)
 * @returns false si puede ser un desarrollador legítimo
 */
export function isDeveloperBlacklisted(name: string | null | undefined): boolean {
  if (!name || name.trim().length === 0) return true; // null/empty → descartar

  const lower = name.toLowerCase().trim();

  // Whitelist tiene prioridad absoluta
  if (isWhitelisted(name)) return false;

  // Check exacto
  if (EXACT_BLACKLIST.has(lower)) return true;

  // Check por patron
  for (const pattern of PATTERN_BLACKLIST) {
    if (pattern.test(lower)) return true;
  }

  return false;
}

/**
 * Limpia texto de FAQs/contenido removiendo menciones de brokers/agencias.
 * Preserva menciones de "Propyte" y "Avica".
 *
 * Reemplaza nombres de brokers conocidos y patrones genéricos por texto neutro.
 */
export function sanitizeFaqContent(text: string): string {
  if (!text) return text;

  let cleaned = text;

  // Reemplazar nombres exactos de brokers/agencias por texto genérico
  for (const name of EXACT_BLACKLIST) {
    const regex = new RegExp(escapeRegex(name), "gi");
    cleaned = cleaned.replace(regex, "el equipo de ventas");
  }

  // Reemplazar patrones genéricos de agencias
  // Ej: "contacta a ABC Real Estate" → "contacta al equipo de ventas"
  const agencyPatterns = [
    /(?:contacta?\s+(?:a|con)\s+)[\w\s]+(?:real\s*estate|realty|properties|broker|inmobiliaria)/gi,
    /(?:a\s+trav[ée]s\s+de\s+)[\w\s]+(?:real\s*estate|realty|properties|broker|inmobiliaria)/gi,
  ];
  for (const pat of agencyPatterns) {
    cleaned = cleaned.replace(pat, "contacta al equipo de ventas");
  }

  return cleaned;
}

/**
 * Sanitiza un array de FAQs, limpiando tanto questions como answers.
 */
export function sanitizeFaqs(
  faqs: Array<{ question: string; answer: string }> | null | undefined
): Array<{ question: string; answer: string }> | null {
  if (!faqs || !Array.isArray(faqs) || faqs.length === 0) return null;

  return faqs.map((faq) => ({
    question: sanitizeFaqContent(faq.question || ""),
    answer: sanitizeFaqContent(faq.answer || ""),
  }));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
