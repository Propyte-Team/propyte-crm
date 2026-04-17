-- =============================================================
-- SCHEMA: investment_analytics
-- Ref NEW DB: oaijxdpevakashxshhvm
-- Generado: 2026-04-13
--
-- Tablas:
--   rental_comparables      (data from public.rental_comparables  DB vieja)
--   airdna_metrics          (data from public.airdna_metrics      DB vieja)
--   rental_estimates        (MAT VIEW agregando rental_comparables)
--   development_financials  (tabla nueva, 1 fila por desarrollo)
--
-- NO se define FK hard a real_estate_hub.Propyte_desarrollos por
-- ahora (evitamos acoplamiento cross-schema mientras estabilizamos
-- el robot que poblara estas filas). Solo index + UNIQUE.
-- =============================================================

-- 1. CREATE SCHEMA
CREATE SCHEMA IF NOT EXISTS investment_analytics;

COMMENT ON SCHEMA investment_analytics IS
  'Datos de rentabilidad: comparables de renta, ocupacion AirDNA, estimaciones agregadas y financieros por desarrollo.';

-- =============================================================
-- TABLA: rental_comparables
-- =============================================================

CREATE TABLE IF NOT EXISTS investment_analytics.rental_comparables (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_portal text NOT NULL,
  source_url text,
  source_id text,
  city text NOT NULL,
  zone text,
  state text NOT NULL DEFAULT 'Quintana Roo',
  property_type text NOT NULL DEFAULT 'departamento',
  rental_type text NOT NULL DEFAULT 'residencial',
  bedrooms smallint,
  bathrooms smallint,
  area_m2 numeric,
  monthly_rent_mxn bigint NOT NULL,
  is_furnished boolean,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  listing_date date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_comparables_pkey PRIMARY KEY (id),
  CONSTRAINT uq_rental_source UNIQUE (source_portal, source_id)
);

CREATE INDEX IF NOT EXISTS idx_rental_city_type_beds
  ON investment_analytics.rental_comparables (city, property_type, bedrooms)
  WHERE (active = true);

CREATE INDEX IF NOT EXISTS idx_rental_scraped
  ON investment_analytics.rental_comparables (scraped_at DESC);

CREATE INDEX IF NOT EXISTS idx_rental_zone
  ON investment_analytics.rental_comparables (city, zone)
  WHERE (active = true);

COMMENT ON TABLE investment_analytics.rental_comparables IS
  'Comparables de renta scrapeados de portales. Residencial + vacacional. Usado por Mercado Renta Tradicional y para agregar rental_estimates.';

-- =============================================================
-- TABLA: airdna_metrics
-- =============================================================

CREATE TABLE IF NOT EXISTS investment_analytics.airdna_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  market text NOT NULL,
  submarket text,
  section text NOT NULL,
  chart text NOT NULL,
  metric_date date NOT NULL,
  metric_name text NOT NULL,
  metric_value numeric,
  scraped_at date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT airdna_metrics_pkey PRIMARY KEY (id),
  CONSTRAINT airdna_metrics_unique_key UNIQUE (market, submarket, section, chart, metric_date, metric_name)
);

CREATE INDEX IF NOT EXISTS idx_airdna_date
  ON investment_analytics.airdna_metrics (metric_date);

CREATE INDEX IF NOT EXISTS idx_airdna_market
  ON investment_analytics.airdna_metrics (market);

CREATE INDEX IF NOT EXISTS idx_airdna_section
  ON investment_analytics.airdna_metrics (market, section);

COMMENT ON TABLE investment_analytics.airdna_metrics IS
  'Metricas AirDNA raw (ocupacion, ADR, RevPAR) por mercado/submarket. Usado por investment analysis vacacional.';

-- =============================================================
-- TABLA: development_financials
-- =============================================================

CREATE TABLE IF NOT EXISTS investment_analytics.development_financials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  development_id text NOT NULL,

  -- Residencial
  estimated_rent_residencial numeric,
  occupancy_rate_res numeric,
  roi_annual_pct numeric,
  irr_5yr numeric,
  irr_10yr numeric,
  cash_on_cash_pct numeric,
  breakeven_months numeric,
  monthly_net_flow numeric,
  cap_rate numeric,
  rent_yield_gross numeric,
  rent_yield_net numeric,

  -- Vacacional
  estimated_rent_vacacional numeric,
  occupancy_rate_vac numeric,
  roi_annual_pct_vac numeric,
  irr_5yr_vac numeric,
  irr_10yr_vac numeric,
  cash_on_cash_pct_vac numeric,
  breakeven_months_vac numeric,
  monthly_net_flow_vac numeric,
  cap_rate_vac numeric,
  rent_yield_gross_vac numeric,
  rent_yield_net_vac numeric,

  -- Meta
  model_version text,
  last_computed timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT development_financials_pkey PRIMARY KEY (id),
  CONSTRAINT uq_development_financials UNIQUE (development_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_financials_development_id
  ON investment_analytics.development_financials (development_id);

CREATE INDEX IF NOT EXISTS idx_dev_financials_yield_gross
  ON investment_analytics.development_financials (rent_yield_gross DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_dev_financials_cap_rate
  ON investment_analytics.development_financials (cap_rate DESC NULLS LAST);

COMMENT ON TABLE investment_analytics.development_financials IS
  'Financials computados por desarrollo: ROI, IRR, yield, cap rate, occupancy (residencial + vacacional). Poblado por robot analytics. development_id referencia real_estate_hub.Propyte_desarrollos.id_desarrollo pero sin FK hard para evitar acoplamiento cross-schema.';

-- Trigger updated_at
CREATE OR REPLACE FUNCTION investment_analytics.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dev_financials_updated_at ON investment_analytics.development_financials;
CREATE TRIGGER trg_dev_financials_updated_at
  BEFORE UPDATE ON investment_analytics.development_financials
  FOR EACH ROW EXECUTE FUNCTION investment_analytics.touch_updated_at();

-- =============================================================
-- MATERIALIZED VIEW: rental_estimates
-- Agregaciones derivadas de rental_comparables.
-- Refresh manual con: REFRESH MATERIALIZED VIEW CONCURRENTLY investment_analytics.rental_estimates;
-- =============================================================

DROP MATERIALIZED VIEW IF EXISTS investment_analytics.rental_estimates;
CREATE MATERIALIZED VIEW investment_analytics.rental_estimates AS
SELECT
  city,
  zone,
  property_type,
  bedrooms,
  rental_type,
  (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY monthly_rent_mxn))::bigint      AS median_rent_mxn,
  ROUND(AVG(monthly_rent_mxn))::bigint                                         AS avg_rent_mxn,
  ROUND(AVG(monthly_rent_mxn::numeric / NULLIF(area_m2, 0)), 2)                AS avg_rent_per_m2,
  COUNT(*)::int                                                                AS sample_size
FROM investment_analytics.rental_comparables
WHERE active = true
  AND monthly_rent_mxn BETWEEN 2000 AND 500000
  AND (area_m2 IS NULL OR (monthly_rent_mxn::numeric / area_m2 BETWEEN 20 AND 2000))
GROUP BY city, zone, property_type, bedrooms, rental_type
HAVING COUNT(*) >= 3;

-- unique index para poder hacer REFRESH CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_estimates_key
  ON investment_analytics.rental_estimates (city, COALESCE(zone, ''), property_type, COALESCE(bedrooms, -1), rental_type);

CREATE INDEX IF NOT EXISTS idx_rental_estimates_city
  ON investment_analytics.rental_estimates (city);

COMMENT ON MATERIALIZED VIEW investment_analytics.rental_estimates IS
  'Agregacion de rental_comparables por city/zone/property_type/bedrooms/rental_type. Minimo 3 comparables por grupo para significancia. Refresh manual.';

-- =============================================================
-- GRANTS
-- anon + authenticated: SELECT en todo (datos publicos para el sitio)
-- service_role: bypass via superuser (no necesita grants explicitos)
-- =============================================================

GRANT USAGE ON SCHEMA investment_analytics TO anon, authenticated, service_role;

GRANT SELECT ON investment_analytics.rental_comparables     TO anon, authenticated;
GRANT SELECT ON investment_analytics.airdna_metrics         TO anon, authenticated;
GRANT SELECT ON investment_analytics.rental_estimates       TO anon, authenticated;
GRANT SELECT ON investment_analytics.development_financials TO anon, authenticated;

-- service_role full (para robots/scrapers)
GRANT ALL ON ALL TABLES IN SCHEMA investment_analytics TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA investment_analytics TO service_role;

-- Default privileges para futuros objetos
ALTER DEFAULT PRIVILEGES IN SCHEMA investment_analytics
  GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA investment_analytics
  GRANT ALL ON TABLES TO service_role;
