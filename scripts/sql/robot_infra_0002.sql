-- ============================================================
-- Robot infrastructure migration 0002 - fix NULL handling en unique indexes
-- ============================================================
-- Bug detectado en primera corrida de Robot 1:
--   Dos properties "60 Norte" con id_desarrollador=NULL generaron dos rows
--   distintas en Propyte_desarrollos en vez de dedupearse. Razon: Postgres
--   no considera NULL == NULL en unique indexes por default.
--
-- Fix: reemplazar idx_desarrollos_nombre_desarrollador con version que usa
--   COALESCE(id_desarrollador::text, 'NULL') como segunda columna.
-- ============================================================

-- 1. Drop viejo index
DROP INDEX IF EXISTS real_estate_hub.idx_desarrollos_nombre_desarrollador;

-- 2. Limpiar duplicados existentes primero (para que CREATE INDEX no falle)
--    Mantener el mas reciente (created_at DESC) para preservar datos mas frescos
DELETE FROM real_estate_hub."Propyte_desarrollos" a
USING real_estate_hub."Propyte_desarrollos" b
WHERE a.ctid < b.ctid
  AND lower(a.nombre_desarrollo) = lower(b.nombre_desarrollo)
  AND COALESCE(a.id_desarrollador::text, 'NULL') = COALESCE(b.id_desarrollador::text, 'NULL')
  AND a.deleted_at IS NULL
  AND b.deleted_at IS NULL;

-- 3. Crear version nueva que dedupea cuando id_desarrollador IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_desarrollos_nombre_desarrollador
  ON real_estate_hub."Propyte_desarrollos"
  (lower(nombre_desarrollo), COALESCE(id_desarrollador::text, 'NULL'))
  WHERE deleted_at IS NULL;
