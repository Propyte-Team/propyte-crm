/**
 * Tipo de cambio USD -> MXN via Banxico SIE (Sistema de Informacion Economica).
 *
 * Serie SF63528 = Tipo de cambio FIX peso-dolar (publicacion oficial Banxico,
 * dia habil ~12:00 CST). Requiere token gratuito:
 *   https://www.banxico.org.mx/SieAPIRest/service/v1/token
 *
 * Cache en memoria 24h, fallback a constante si el API falla.
 */

import type { FxRate } from "./types";

const BANXICO_URL =
  "https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF63528/datos/oportuno";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FALLBACK_USD_TO_MXN = 20.0;

let cache: { rate: FxRate; expiresAt: number } | null = null;

interface BanxicoResponse {
  bmx: {
    series: Array<{
      datos: Array<{ fecha: string; dato: string }>;
    }>;
  };
}

async function fetchFromBanxico(token: string): Promise<FxRate> {
  const res = await fetch(BANXICO_URL, {
    headers: { "Bmx-Token": token, Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Banxico API returned ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as BanxicoResponse;
  const datum = json.bmx?.series?.[0]?.datos?.[0];
  if (!datum) {
    throw new Error("Banxico respondio sin series[0].datos[0]");
  }

  const rate = parseFloat(datum.dato);
  if (isNaN(rate) || rate < 5 || rate > 100) {
    throw new Error(`Banxico devolvio tasa invalida: ${datum.dato}`);
  }

  // fecha viene como "DD/MM/YYYY" en Banxico
  const [dd, mm, yyyy] = datum.fecha.split("/");
  return {
    source: "banxico",
    usdToMxn: rate,
    date: `${yyyy}-${mm}-${dd}`,
    fetchedAt: new Date(),
  };
}

export async function getUsdToMxnRate(): Promise<FxRate> {
  // cache hit
  if (cache && cache.expiresAt > Date.now()) {
    return cache.rate;
  }

  const token = process.env.BANXICO_API_TOKEN;
  if (!token) {
    console.warn(
      "[fx] BANXICO_API_TOKEN no definido, usando fallback USD_TO_MXN=" + FALLBACK_USD_TO_MXN
    );
    return {
      source: "fallback",
      usdToMxn: FALLBACK_USD_TO_MXN,
      date: new Date().toISOString().slice(0, 10),
      fetchedAt: new Date(),
    };
  }

  try {
    const rate = await fetchFromBanxico(token);
    cache = { rate, expiresAt: Date.now() + CACHE_TTL_MS };
    return rate;
  } catch (err) {
    console.warn(
      "[fx] Banxico fallo, usando fallback USD_TO_MXN=" +
        FALLBACK_USD_TO_MXN +
        ": " +
        (err instanceof Error ? err.message : String(err))
    );
    return {
      source: "fallback",
      usdToMxn: FALLBACK_USD_TO_MXN,
      date: new Date().toISOString().slice(0, 10),
      fetchedAt: new Date(),
    };
  }
}

/**
 * Convierte un monto en USD a MXN usando la tasa actual de Banxico.
 * Retorna NaN si el input es invalido.
 */
export async function convertUsdToMxn(usdAmount: number): Promise<number> {
  if (isNaN(usdAmount) || usdAmount < 0) return NaN;
  const fx = await getUsdToMxnRate();
  return Math.round(usdAmount * fx.usdToMxn * 100) / 100;
}

/**
 * Normaliza un precio de public.properties (price_cents + currency) a MXN pesos.
 * - price_cents viene en "centavos" (divide entre 100)
 * - Si currency=USD, convierte via Banxico
 * - Si currency=MXN, devuelve directo
 * - Si price_cents o currency invalido, devuelve null
 */
export async function normalizePriceToMxn(
  priceCents: bigint | number | null,
  currency: string | null
): Promise<number | null> {
  if (priceCents == null || currency == null) return null;
  const priceNum = typeof priceCents === "bigint" ? Number(priceCents) : priceCents;
  if (isNaN(priceNum) || priceNum <= 0) return null;

  const amount = priceNum / 100;

  if (currency.toUpperCase() === "MXN") return amount;
  if (currency.toUpperCase() === "USD") return await convertUsdToMxn(amount);

  return null; // moneda desconocida
}

/** Reset cache (solo para tests) */
export function __resetFxCache(): void {
  cache = null;
}
