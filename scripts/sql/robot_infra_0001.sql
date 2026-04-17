-- ============================================================
-- Robot infrastructure migration 0001 (idempotente)
-- ============================================================
-- Agrega a real_estate_hub:
--  1. Columnas jsonb content_es/en/fr en Propyte_unidades y Propyte_desarrollos
--     (espeja la estructura de public.properties.content_es/en/fr: faq, hero,
--      features, location, lifestyle, metaTitle, metaDescription, contentVersion)
--  2. Metadatos scraper: ext_scraper_first_seen_at, ext_google_maps_url, ext_ai_enriched_at
--  3. Tabla Propyte_robot_runs para observabilidad
--  4. Tabla Propyte_faqs_zona para FAQs genericas por ciudad
--
-- Decision arquitectonica (2026-04-13):
--  Felipe ya tiene public.properties.content_es/en/fr jsonb con estructura rica
--  (faq array, hero, features, location, lifestyle, metaTitle, metaDescription).
--  En lugar de 20+ columnas separadas, espejamos esa estructura con 3 jsonb.
--  FR multilenguaje queda cubierto sin ALTER TABLE adicionales.
-- ============================================================

-- 1. Columnas content_* jsonb en Propyte_unidades ------------
ALTER TABLE real_estate_hub."Propyte_unidades"
  ADD COLUMN IF NOT EXISTS ext_content_es jsonb,
  ADD COLUMN IF NOT EXISTS ext_content_en jsonb,
  ADD COLUMN IF NOT EXISTS ext_content_fr jsonb,
  ADD COLUMN IF NOT EXISTS ext_scraper_first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS ext_scraper_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS ext_scraper_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS ext_content_hash text,
  ADD COLUMN IF NOT EXISTS ext_google_maps_url text,
  ADD COLUMN IF NOT EXISTS ext_ai_enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS ext_source_url text,
  ADD COLUMN IF NOT EXISTS ext_detection_source text;

COMMENT ON COLUMN real_estate_hub."Propyte_unidades".ext_source_url IS
  'URL canonica de origen (public.properties.source_url). Clave de upsert idempotente para Robot 1.';
COMMENT ON COLUMN real_estate_hub."Propyte_unidades".ext_detection_source IS
  'Nombre del robot que creo/actualizo esta unidad. Ej: robot-01-classifier.';

COMMENT ON COLUMN real_estate_hub."Propyte_unidades".ext_content_es IS
  'Espeja public.properties.content_es jsonb: { faq[], hero, features, location, lifestyle, metaTitle, metaDescription, contentVersion }. Generado por pipeline de Felipe en status=published.';
COMMENT ON COLUMN real_estate_hub."Propyte_unidades".ext_content_hash IS
  'content_hash de public.properties al momento de ultima sync. Si cambia, re-sincronizar.';
COMMENT ON COLUMN real_estate_hub."Propyte_unidades".ext_ai_enriched_at IS
  'Lock anti-regeneracion para Robot 5. Si es NOT NULL, Robot 5 saltea esta unidad.';

-- 2. Columnas content_* jsonb en Propyte_desarrollos --------
ALTER TABLE real_estate_hub."Propyte_desarrollos"
  ADD COLUMN IF NOT EXISTS ext_content_es jsonb,
  ADD COLUMN IF NOT EXISTS ext_content_en jsonb,
  ADD COLUMN IF NOT EXISTS ext_content_fr jsonb,
  ADD COLUMN IF NOT EXISTS ext_scraper_first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS ext_scraper_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS ext_scraper_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS ext_content_hashes jsonb,
  ADD COLUMN IF NOT EXISTS ext_google_maps_url text,
  ADD COLUMN IF NOT EXISTS ext_ai_enriched_at timestamptz;

COMMENT ON COLUMN real_estate_hub."Propyte_desarrollos".ext_content_hashes IS
  'jsonb { property_id: content_hash, ... } de todas las properties que contribuyeron al desarrollo. Para deteccion de cambios.';

-- 3. Tabla Propyte_robot_runs -------------------------------
CREATE TABLE IF NOT EXISTS real_estate_hub."Propyte_robot_runs" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  robot_name text NOT NULL,              -- '01-classifier' | '02-images' | '03-amenities' | '04-geo' | '05-ai-content'
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running', -- 'running' | 'success' | 'failure' | 'partial' | 'dry_run'
  inputs jsonb,                          -- { filter: {...}, limit: N, dry_run: bool, source: '...' }
  outputs jsonb,                         -- { props_read, desarrollos_created, unidades_updated, ... }
  errors jsonb,                          -- [{ property_id, error, stack }, ...]
  duration_ms integer,
  git_sha text,                          -- GITHUB_SHA del workflow o commit local
  host text,                             -- 'github-actions' | 'local' | 'vercel'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_robot_runs_name_started
  ON real_estate_hub."Propyte_robot_runs" (robot_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_robot_runs_status
  ON real_estate_hub."Propyte_robot_runs" (status, started_at DESC);

COMMENT ON TABLE real_estate_hub."Propyte_robot_runs" IS
  'Log estructurado de cada ejecucion de robots de sync public.* -> real_estate_hub.*';

-- 4. Tabla Propyte_faqs_zona --------------------------------
CREATE TABLE IF NOT EXISTS real_estate_hub."Propyte_faqs_zona" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ciudad text NOT NULL,                  -- 'Tulum', 'Playa del Carmen', 'Cancun', 'Merida', 'global'
  estado text,                           -- 'Quintana Roo', 'Yucatan', etc. NULL = cualquier estado
  pregunta_es text NOT NULL,
  respuesta_es text NOT NULL,
  pregunta_en text,
  respuesta_en text,
  pregunta_fr text,
  respuesta_fr text,
  orden integer NOT NULL DEFAULT 0,
  ext_publicado boolean NOT NULL DEFAULT true,
  ext_destacado boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_faqs_zona_ciudad_orden
  ON real_estate_hub."Propyte_faqs_zona" (ciudad, orden)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_faqs_zona_publicado
  ON real_estate_hub."Propyte_faqs_zona" (ciudad)
  WHERE deleted_at IS NULL AND ext_publicado = true;

COMMENT ON TABLE real_estate_hub."Propyte_faqs_zona" IS
  'FAQs genericas por ciudad/zona (no especificas de una property). Reemplaza FAQs hardcoded en tema WP.';

-- 5. Unique constraint para upsert idempotente -------------
-- (updated_at se maneja via Prisma @updatedAt o app code, no trigger)
-- Permite ON CONFLICT (ext_source_url) en Propyte_unidades para Robot 1
CREATE UNIQUE INDEX IF NOT EXISTS idx_unidades_ext_source_url
  ON real_estate_hub."Propyte_unidades" (ext_source_url)
  WHERE ext_source_url IS NOT NULL AND deleted_at IS NULL;

-- Permite ON CONFLICT (nombre_desarrollo, id_desarrollador) en Propyte_desarrollos
-- (case-insensitive via lower() para tolerar variacion mayusculas)
CREATE UNIQUE INDEX IF NOT EXISTS idx_desarrollos_nombre_desarrollador
  ON real_estate_hub."Propyte_desarrollos" (lower(nombre_desarrollo), id_desarrollador)
  WHERE deleted_at IS NULL;

-- Permite ON CONFLICT (lower(nombre_desarrollador)) en Propyte_desarrolladores
CREATE UNIQUE INDEX IF NOT EXISTS idx_desarrolladores_nombre_lower
  ON real_estate_hub."Propyte_desarrolladores" (lower(nombre_desarrollador))
  WHERE deleted_at IS NULL;
