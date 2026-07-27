// Catálogo PUBLICADO — única capa de lectura de lo que propyte.com muestra al público.
//
// El gate vive en UNA constante (PUBLIC_GATE) y se interpola en todas las queries.
// Motivo: repetir el criterio a mano produjo tres definiciones divergentes de "publicado"
// (sitio 21 devs vs pipeline_status='Publicado' 16). Si necesitas una query nueva,
// interpola PUBLIC_GATE — no reescribas la condición.
//
// SQL directo al schema real_estate_hub por la MISMA conexión Postgres, igual que
// src/lib/hub/client.ts y que el sitio web. El CRM no posee inventario: solo lo consulta.
import prisma from "@/lib/db";
import type {
  CatalogResult,
  DevelopmentCatalogFilters,
  PublishedDevelopment,
  PublishedDevelopmentDetail,
  PublishedUnit,
  UnitCatalogFilters,
} from "./catalog-types";

/** Gate público: idéntico al de Next_Propyte_web/src/lib/supabase/queries.ts */
export const PUBLIC_GATE = "approved_at IS NOT NULL AND deleted_at IS NULL";

function fail<T>(fnName: string, err: unknown, fallback: T): CatalogResult<T> {
  console.error(`[hub/catalog] ${fnName} falló`, { err });
  return { data: fallback, error: "No se pudo consultar el catálogo del Hub" };
}

// Columnas de tarjeta/lista. `publishedUnits` cuenta unidades con el MISMO gate,
// no confía en el contador denormalizado available_units del Hub.
const DEV_LIST_COLS = `
  d.id::text                        AS id,
  d.slug::text                      AS slug,
  COALESCE(d.publication_title, d.name)::text AS name,
  d.developer_name::text            AS "developerName",
  d.development_type::text          AS "developmentType",
  d.stage::text                     AS stage,
  d.city::text                      AS city,
  d.state::text                     AS state,
  d.zone::text                      AS zone,
  d.price_min_mxn::float8           AS "priceMinMxn",
  d.price_max_mxn::float8           AS "priceMaxMxn",
  d.currency::text                  AS currency,
  d.total_units::int                AS "totalUnits",
  d.available_units::int            AS "availableUnits",
  d.reserved_units::int             AS "reservedUnits",
  d.sold_units::int                 AS "soldUnits",
  d.discounted_units_count::int     AS "discountedUnitsCount",
  d.images[1]::text                 AS "coverImage",
  d.estimated_delivery::text        AS "estimatedDelivery",
  d.delivery_text::text             AS "deliveryText",
  d.construction_progress::int      AS "constructionProgress",
  (SELECT count(*) FROM real_estate_hub.v_units u
    WHERE u.development_id = d.id AND ${PUBLIC_GATE})::int AS "publishedUnits"
`;

export async function listPublishedDevelopments(
  filters: DevelopmentCatalogFilters = {}
): Promise<CatalogResult<PublishedDevelopment[]>> {
  const limit = Math.min(filters.limit ?? 200, 500);
  try {
    const rows = await prisma.$queryRawUnsafe<PublishedDevelopment[]>(
      `SELECT ${DEV_LIST_COLS}
         FROM real_estate_hub.v_developments d
        WHERE ${PUBLIC_GATE}
          AND ($1::text IS NULL OR COALESCE(d.publication_title, d.name) ILIKE '%' || $1 || '%'
               OR d.developer_name ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR d.city ILIKE $2)
          AND ($3::text IS NULL OR d.zone ILIKE '%' || $3 || '%')
          AND ($4::text IS NULL OR d.stage = $4)
          AND ($5::float8 IS NULL OR d.price_max_mxn >= $5)
          AND ($6::float8 IS NULL OR d.price_min_mxn <= $6)
          AND ($7::bool IS NOT TRUE OR COALESCE(d.available_units, 0) > 0)
        ORDER BY COALESCE(d.publication_title, d.name) ASC
        LIMIT ${limit}`,
      filters.search ?? null,
      filters.city ?? null,
      filters.zone ?? null,
      filters.stage ?? null,
      filters.priceMin ?? null,
      filters.priceMax ?? null,
      filters.onlyWithAvailable ?? null
    );
    return { data: rows, error: null };
  } catch (err) {
    return fail("listPublishedDevelopments", err, []);
  }
}

export async function getPublishedDevelopment(
  id: string
): Promise<CatalogResult<PublishedDevelopmentDetail | null>> {
  try {
    const rows = await prisma.$queryRawUnsafe<PublishedDevelopmentDetail[]>(
      `SELECT ${DEV_LIST_COLS},
              COALESCE(d.images, '{}')::text[]          AS images,
              COALESCE(d.amenities, '{}')::text[]       AS amenities,
              COALESCE(d.property_types, '{}')::text[]  AS "propertyTypes",
              d.description_es::text                    AS "descriptionEs",
              d.description_short_es::text              AS "descriptionShortEs",
              d.roi_projected::float8                   AS "roiProjected",
              d.roi_rental_monthly::float8              AS "roiRentalMonthly",
              d.roi_appreciation::float8                AS "roiAppreciation",
              d.financing_down_payment::float8          AS "financingDownPayment",
              d.financing_months::int                   AS "financingMonths",
              d.financing_interest::float8              AS "financingInterest",
              d.address::text                           AS address,
              d.neighborhood::text                      AS neighborhood,
              d.municipality::text                      AS municipality,
              d.lat::float8                             AS lat,
              d.lng::float8                             AS lng,
              d.maps_url::text                          AS "mapsUrl",
              d.beach_distance::text                    AS "beachDistance",
              d.brochure_url::text                      AS "brochureUrl",
              d.virtual_tour_url::text                  AS "virtualTourUrl",
              d.masterplan::text                        AS masterplan,
              d.video_url::text                         AS "videoUrl",
              d.commission_rate::float8                 AS "commissionRate",
              d.crm_relationship::text                  AS "crmRelationship",
              d.contact_name::text                      AS "contactName",
              d.contact_phone::text                     AS "contactPhone"
         FROM real_estate_hub.v_developments d
        WHERE ${PUBLIC_GATE}
          AND (d.id::text = $1 OR d.slug = $1)
        LIMIT 1`,
      id
    );
    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return fail("getPublishedDevelopment", err, null);
  }
}

const UNIT_COLS = `
  u.id::text                   AS id,
  u.slug::text                 AS slug,
  u.title::text                AS title,
  u.unit_number::text          AS "unitNumber",
  u.unit_type::text            AS "unitType",
  u.typology::text             AS typology,
  u.status::text                AS status,
  u.is_presale                 AS "isPresale",
  u.bedrooms::int              AS bedrooms,
  u.bathrooms::int             AS bathrooms,
  u.half_baths::int            AS "halfBaths",
  u.area_m2::float8            AS "areaM2",
  u.built_area_m2::float8      AS "builtAreaM2",
  u.price_mxn::float8          AS "priceMxn",
  u.price_usd::float8          AS "priceUsd",
  u.currency::text             AS currency,
  u.discount_price_mxn::float8 AS "discountPriceMxn",
  u.discount_pct::float8       AS "discountPct",
  u.is_discount_active         AS "isDiscountActive",
  COALESCE(u.cover_image, u.images[1])::text AS "coverImage",
  u.development_id::text       AS "developmentId",
  u.development_name::text     AS "developmentName",
  u.development_slug::text     AS "developmentSlug",
  u.city::text                 AS city,
  u.zone::text                 AS zone,
  u.fin_directo                AS "finDirecto",
  u.fin_hipotecario            AS "finHipotecario",
  u.fin_enganche_pct::float8   AS "finEnganchePct",
  u.fin_meses_opciones::int[]  AS "finMesesOpciones",
  u.fin_tasa::float8           AS "finTasa",
  u.fin_esquemas_pago          AS "finEsquemasPago",
  u.fin_preventa               AS "finPreventa"
`;

export async function listPublishedUnits(
  filters: UnitCatalogFilters = {}
): Promise<CatalogResult<PublishedUnit[]>> {
  const limit = Math.min(filters.limit ?? 200, 500);
  try {
    const rows = await prisma.$queryRawUnsafe<PublishedUnit[]>(
      `SELECT ${UNIT_COLS}
         FROM real_estate_hub.v_units u
        WHERE ${PUBLIC_GATE}
          AND ($1::text IS NULL OR u.development_id::text = $1)
          AND ($2::text IS NULL OR u.title ILIKE '%' || $2 || '%' OR u.unit_number ILIKE '%' || $2 || '%')
          AND ($3::int IS NULL OR u.bedrooms >= $3)
          AND ($4::float8 IS NULL OR u.price_mxn >= $4)
          AND ($5::float8 IS NULL OR u.price_mxn <= $5)
          AND ($6::text IS NULL OR u.zone ILIKE '%' || $6 || '%')
        ORDER BY u.unit_number ASC NULLS LAST
        LIMIT ${limit}`,
      filters.developmentId ?? null,
      filters.search ?? null,
      filters.bedrooms ?? null,
      filters.priceMin ?? null,
      filters.priceMax ?? null,
      filters.zone ?? null
    );
    return { data: rows, error: null };
  } catch (err) {
    return fail("listPublishedUnits", err, []);
  }
}

export async function getPublishedUnit(id: string): Promise<CatalogResult<PublishedUnit | null>> {
  try {
    const rows = await prisma.$queryRawUnsafe<PublishedUnit[]>(
      `SELECT ${UNIT_COLS}
         FROM real_estate_hub.v_units u
        WHERE ${PUBLIC_GATE}
          AND (u.id::text = $1 OR u.slug = $1)
        LIMIT 1`,
      id
    );
    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return fail("getPublishedUnit", err, null);
  }
}
