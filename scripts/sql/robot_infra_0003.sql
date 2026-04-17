-- ============================================================
-- Robot infrastructure migration 0003 - legacy_property_id para idempotencia
-- ============================================================
-- Bug detectado en segunda corrida:
--   Properties con status='review' no exponen ext_source_url (SENSITIVE, solo
--   de published) → el ON CONFLICT (ext_source_url) no matchea → INSERT duplicado.
--
-- Fix: identificar unidades por el UUID canonico de public.properties.id
--   (= ext_legacy_property_id). Es NEUTRAL (el UUID no revela rival), siempre
--   existe, y da idempotencia perfecta independiente del status.
-- ============================================================

-- 1. Columna nueva
ALTER TABLE real_estate_hub."Propyte_unidades"
  ADD COLUMN IF NOT EXISTS ext_legacy_property_id uuid;

COMMENT ON COLUMN real_estate_hub."Propyte_unidades".ext_legacy_property_id IS
  'UUID de public.properties.id que dio origen a esta unidad. Clave canonica de dedup para Robot 1 (estable independiente del status).';

-- 2. Limpiar duplicados existentes (unidades creadas antes del fix)
--    Sin legacy_property_id no podemos deduplicar retroactivamente con seguridad,
--    asi que borramos TODAS las unidades del robot-01-classifier y dejamos
--    que la proxima corrida las recree con la clave correcta.
--    Esto es seguro porque son datos derivados — la fuente (public.properties) persiste.
DELETE FROM real_estate_hub."Propyte_unidades"
WHERE ext_detection_source = 'robot-01-classifier';

-- 3. Drop viejo partial index sobre ext_source_url (no va a ser util)
DROP INDEX IF EXISTS real_estate_hub.idx_unidades_ext_source_url;

-- 4. Nuevo unique index sobre ext_legacy_property_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_unidades_legacy_property_id
  ON real_estate_hub."Propyte_unidades" (ext_legacy_property_id)
  WHERE ext_legacy_property_id IS NOT NULL AND deleted_at IS NULL;
