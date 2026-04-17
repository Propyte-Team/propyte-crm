/**
 * Funciones de agregacion a nivel desarrollo:
 *  - priceMinMax: MIN/MAX precio_mxn normalizado sobre todas las properties del grupo
 *  - orAmenities: OR boolean por cada de 16 amenidades desde raw_data.amenities
 *  - pickByTieBreaker: wrapper de winnerByFieldSensitivity para campos string/scalar
 */

import { normalizePriceToMxn } from "../shared/fx";
import { winnerByFieldSensitivity, type Candidate } from "../shared/source-priority";
import type { PublicProperty } from "../shared/types";

// ============================================================
// Precios
// ============================================================

export interface PriceAggregation {
  minMxn: number | null;
  maxMxn: number | null;
  count: number;
  minUsd: number | null;
  maxUsd: number | null;
  countUsd: number;
}

export async function aggregatePrices(
  properties: Array<Pick<PublicProperty, "price_cents" | "currency">>
): Promise<PriceAggregation> {
  const mxnPrices: number[] = [];
  const usdPrices: number[] = [];

  for (const p of properties) {
    const mxn = await normalizePriceToMxn(p.price_cents, p.currency);
    if (mxn != null && mxn > 0) mxnPrices.push(mxn);

    // tambien guardamos USD nativo si aplica (sin conversion)
    if (p.currency?.toUpperCase() === "USD" && p.price_cents != null) {
      const usdAmount = Number(p.price_cents) / 100;
      if (usdAmount > 0) usdPrices.push(usdAmount);
    }
  }

  return {
    minMxn: mxnPrices.length > 0 ? Math.min(...mxnPrices) : null,
    maxMxn: mxnPrices.length > 0 ? Math.max(...mxnPrices) : null,
    count: mxnPrices.length,
    minUsd: usdPrices.length > 0 ? Math.min(...usdPrices) : null,
    maxUsd: usdPrices.length > 0 ? Math.max(...usdPrices) : null,
    countUsd: usdPrices.length,
  };
}

// ============================================================
// Amenities (16 bools + adicionales jsonb)
// ============================================================

/**
 * Mapeo de patterns regex → columna destino en Propyte_desarrollos.
 * Basado en:
 *  - Catalogo DataMktMx (alberca, gimnasio, jacuzzi, coworking, cancha_tenis, ...)
 *  - Sinonimos multi-idioma (pool, gym, yoga, ...)
 *  - Schema existente de real_estate_hub
 */
export interface AmenityMapping {
  pattern: RegExp;
  target: string; // column name en Propyte_desarrollos
}

/**
 * Normaliza una amenity string para match: lowercase + remueve acentos + trim.
 * Ejemplo: "Salón de eventos" → "salon de eventos"
 */
function normalizeAmenity(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Patterns aplicados sobre la version NORMALIZADA (sin acentos, lowercase).
 * Escribe patterns sin acentos.
 */
export const AMENITY_MAP: AmenityMapping[] = [
  // Albercas (priv antes de com para precedencia)
  { pattern: /alberca[\s_]priv|private[\s_]pool|piscina[\s_]priv/, target: "amenidad_alberca_privada" },
  { pattern: /alberca|piscina|pool|swimming|chapoteadero/, target: "amenidad_alberca_comunitaria" },
  // Gym / fitness
  { pattern: /gimnasio|gym|fitness/, target: "amenidad_gym" },
  // Salon eventos / casa club (eventos sociales)
  { pattern: /salon[\s_]eventos|salon[\s_]de[\s_]eventos|event[\s_]hall|salon[\s_]fiestas|casa[\s_]club|club[\s_]house|teens?[\s_]club/, target: "amenidad_salon_eventos" },
  // Coworking
  { pattern: /coworking|workspace|business[\s_]center/, target: "amenidad_coworking" },
  // Rooftop (azotea, roof garden, sky bar, motor lobby NO, palapa si)
  { pattern: /rooftop|roof[\s_]garden|azotea|sky[\s_]bar|sky[\s_]deck|palapa|terraza[\s_]principal/, target: "amenidad_rooftop" },
  // Fire pit / asadores / bbq
  { pattern: /fire[\s_]?pit|fogata|asador|bbq|grill/, target: "amenidad_fire_pit" },
  // Yoga / zen
  { pattern: /yoga|area[\s_]zen|zen/, target: "amenidad_yoga" },
  // Jardin privado
  { pattern: /jardin[\s_]priv|private[\s_]garden/, target: "amenidad_jardin_privado" },
  // Jardin comun / areas verdes / senderos
  { pattern: /jardin[\s_]com|shared[\s_]garden|jardin[\s_]interior|areas?[\s_]verdes?|senderos?|andadores?[\s_]ecologicos?|lago[\s_]artificial|puentes?[\s_]colgantes?/, target: "amenidad_jardin_comunitario" },
  // Spa / jacuzzi / sauna / temazcal / vapor
  { pattern: /^spa$|spa[\s_]|jacuzzi|sauna|temazcal|vapor|hidroneumatico/, target: "amenidad_spa" },
  // Restaurante / bar / comedor
  { pattern: /restaurante|restaurant|^bar$|bar[\s_]|comedor|beach[\s_]club/, target: "amenidad_restaurante" },
  // Concierge
  { pattern: /concierge|conserje/, target: "amenidad_concierge" },
  // Seguridad 24h (incluye "seguridad" solo - muy comun)
  { pattern: /seguridad|vigilancia|caseta[\s_]seguridad/, target: "amenidad_seguridad_24h" },
  // CCTV / camaras (sin acentos - normalizado)
  { pattern: /cctv|camaras?|video[\s_]vigilancia/, target: "amenidad_cctv" },
  // Acceso controlado
  { pattern: /acceso[\s_]contr|controlled[\s_]access|access[\s_]control/, target: "amenidad_acceso_controlado" },
  // Lobby
  { pattern: /^lobby|lobby[\s_]|motor[\s_]lobby/, target: "amenidad_lobby" },
  // Elevador
  { pattern: /elevador|elevator|ascensor/, target: "amenidad_elevador" },
  // Bodega / storage
  { pattern: /bodega|storage|trastero/, target: "amenidad_bodega" },
  // Pet zone
  { pattern: /pet[\s_]|mascota|pet[\s_]zone|pet[\s_]friendly|se[\s_]aceptan[\s_]mascotas/, target: "amenidad_pet_zone" },
  // Canchas / deportes (incluye pickleball, mini golf, jogging, ciclopista, skate, muelle)
  { pattern: /cancha|court|squash|tenis|padel|pickleball|basket|futbol|voleibol|mini[\s_]golf|campo[\s_]de[\s_]golf|jogging|ciclopista|skate|muelle|marina/, target: "amenidad_cancha" },
  // Area ninos / ludoteca / teens club
  { pattern: /area[\s_]ni[n]os|kids|juegos[\s_]infantiles|area[\s_]de[\s_]juegos|area_juegos|ludoteca|chapoteadero/, target: "amenidad_area_ninos" },
];

/** Nombres de las 16+ columnas amenidad_* — para inicializar con false. */
export const AMENITY_COLUMNS = Array.from(new Set(AMENITY_MAP.map((m) => m.target)));

export interface AmenitiesAggregation {
  booleans: Record<string, boolean>;
  additional: string[];
  totalMatched: number;
  totalUnmatched: number;
}

/**
 * Extrae amenities de raw_data.amenities (array de strings o string) y las mapea
 * a las 16 columnas bool. Lo no mapeado va a `additional` (→ amenidades_adicionales jsonb).
 *
 * Aplica OR boolean: si CUALQUIER property del grupo tiene "alberca", el desarrollo
 * completo gana amenidad_alberca_comunitaria = true.
 */
export function aggregateAmenities(
  properties: Array<Pick<PublicProperty, "raw_data">>
): AmenitiesAggregation {
  const booleans: Record<string, boolean> = {};
  for (const col of AMENITY_COLUMNS) booleans[col] = false;

  const additionalSet = new Set<string>();
  let totalMatched = 0;
  let totalUnmatched = 0;

  for (const p of properties) {
    const raw = p.raw_data?.amenities;
    const list: string[] = [];

    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string") list.push(item);
        else if (typeof item === "object" && item != null) {
          // algunos scrapers devuelven {slug, name}
          const obj = item as Record<string, unknown>;
          if (typeof obj.slug === "string") list.push(obj.slug);
          else if (typeof obj.name === "string") list.push(obj.name);
        }
      }
    } else if (typeof raw === "string") {
      list.push(raw);
    }

    for (const amenity of list) {
      const normalized = normalizeAmenity(amenity);
      if (!normalized) continue;
      const matched = AMENITY_MAP.find((m) => m.pattern.test(normalized));
      if (matched) {
        booleans[matched.target] = true;
        totalMatched++;
      } else {
        additionalSet.add(amenity.trim()); // preserva original con acentos en adicionales
        totalUnmatched++;
      }
    }
  }

  return {
    booleans,
    additional: Array.from(additionalSet),
    totalMatched,
    totalUnmatched,
  };
}

// ============================================================
// Tie-breaker helper para scalars desde PublicProperty
// ============================================================

type TieBreakerProperty = PublicProperty & { source_domain: string };

export function buildCandidates<T>(
  properties: TieBreakerProperty[],
  extractor: (p: TieBreakerProperty) => T | null
): Candidate<T>[] {
  return properties.map((p) => ({
    propertyId: p.id,
    sourceDomain: p.source_domain,
    status: p.status,
    lastSeenAt: p.last_seen_at,
    value: extractor(p),
  }));
}

export function pickByTieBreaker<T>(
  properties: TieBreakerProperty[],
  extractor: (p: TieBreakerProperty) => T | null,
  fieldName: string
): T | null {
  const candidates = buildCandidates(properties, extractor);
  return winnerByFieldSensitivity(candidates, fieldName);
}
