-- ============================================================
-- Cleanup canónico de picklists Supabase para sync Zoho
-- Fuente de verdad: Hub UI dropdowns (screenshots Luis 2026-05-22)
-- Riesgo: UPDATEs masivos en Propyte_unidades (~1330 filas) + Propyte_desarrollos
-- Ejecutar en orden. Cada paso es reversible vía pgaudit/backup.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Propyte_unidades.tipo_unidad — collapse case-mix + mover variantes a subtipo
-- ============================================================

-- 1.1  PENTHOUSE → Penthouse (sin subtipo extra; ya es el tipo)
UPDATE real_estate_hub."Propyte_unidades"
SET tipo_unidad = 'Penthouse'
WHERE tipo_unidad = 'PENTHOUSE';

-- 1.2  PENTGARDEN → tipo=Penthouse, subtipo=PentGarden
UPDATE real_estate_hub."Propyte_unidades"
SET tipo_unidad = 'Penthouse',
    subtipo_unidad = COALESCE(NULLIF(subtipo_unidad,''), 'PentGarden')
WHERE tipo_unidad = 'PENTGARDEN';

-- 1.3  CORNER → tipo=Departamento, subtipo=Corner
UPDATE real_estate_hub."Propyte_unidades"
SET tipo_unidad = 'Departamento',
    subtipo_unidad = COALESCE(NULLIF(subtipo_unidad,''), 'Corner')
WHERE tipo_unidad = 'CORNER';

-- 1.4  ESTUDIO → Estudio
UPDATE real_estate_hub."Propyte_unidades"
SET tipo_unidad = 'Estudio'
WHERE tipo_unidad = 'ESTUDIO';

-- 1.5  ESTUDIO DOBLE → tipo=Estudio, subtipo=Estudio Doble
UPDATE real_estate_hub."Propyte_unidades"
SET tipo_unidad = 'Estudio',
    subtipo_unidad = COALESCE(NULLIF(subtipo_unidad,''), 'Estudio Doble')
WHERE tipo_unidad = 'ESTUDIO DOBLE';

-- 1.6  Estudio + Suite → tipo=Estudio, subtipo=Estudio + Suite
UPDATE real_estate_hub."Propyte_unidades"
SET tipo_unidad = 'Estudio',
    subtipo_unidad = COALESCE(NULLIF(subtipo_unidad,''), 'Estudio + Suite')
WHERE tipo_unidad = 'Estudio + Suite';

-- 1.7  Local Comercial → Local comercial (l minúscula, canónico Hub)
UPDATE real_estate_hub."Propyte_unidades"
SET tipo_unidad = 'Local comercial'
WHERE tipo_unidad = 'Local Comercial';

-- 1.8  LOCK-OFF → tipo=Departamento, subtipo=Lock-Off
UPDATE real_estate_hub."Propyte_unidades"
SET tipo_unidad = 'Departamento',
    subtipo_unidad = COALESCE(NULLIF(subtipo_unidad,''), 'Lock-Off')
WHERE tipo_unidad = 'LOCK-OFF';

-- 1.9  Hotel → tipo=Departamento (decisión Luis 2026-05-22)
UPDATE real_estate_hub."Propyte_unidades"
SET tipo_unidad = 'Departamento',
    subtipo_unidad = COALESCE(NULLIF(subtipo_unidad,''), 'Hotel')
WHERE tipo_unidad = 'Hotel';

-- 1.10 "2 Recámaras" → tipo=Departamento, ext_tipologia="2 Recámaras"
UPDATE real_estate_hub."Propyte_unidades"
SET tipo_unidad = 'Departamento',
    ext_tipologia = COALESCE(NULLIF(ext_tipologia,''), '2 Recámaras')
WHERE tipo_unidad = '2 Recámaras';

-- ============================================================
-- 2. Propyte_unidades.estado_unidad — Capitalize canónico (Disponible, Preventa, …)
-- ============================================================
UPDATE real_estate_hub."Propyte_unidades" SET estado_unidad = 'Disponible'      WHERE estado_unidad = 'disponible';
UPDATE real_estate_hub."Propyte_unidades" SET estado_unidad = 'Preventa'        WHERE estado_unidad = 'preventa';
UPDATE real_estate_hub."Propyte_unidades" SET estado_unidad = 'Vendida'         WHERE estado_unidad = 'vendida';
UPDATE real_estate_hub."Propyte_unidades" SET estado_unidad = 'Renta'           WHERE estado_unidad = 'renta';
UPDATE real_estate_hub."Propyte_unidades" SET estado_unidad = 'Entrega inmediata' WHERE estado_unidad = 'entrega_inmediata';

-- ============================================================
-- 3. Propyte_unidades.moneda_principal — alinear con Zoho UI ("MXN (Pesos)")
--    Decisión recomendada: dejar en Supabase como "MXN" + agregar al picklist Zoho
--    como display "MXN" (sin paréntesis). NO se modifica BD en este script.
-- ============================================================
-- (no-op)

-- ============================================================
-- 4. Propyte_unidades.tipo_entrega — Capitalize / aliases
--    "Amueblada" (5) y "Equipada (turnkey)" (2) → mantener como están y agregarlos
--    al picklist Zoho. (Cambiar en BD rompería significado.) — no-op.
-- ============================================================
-- (no-op)

-- ============================================================
-- 5. Propyte_unidades.tipo_rendimiento — "Mixto (renta + plusvalía)" (7)
--    Mantener en BD y agregar al picklist Zoho. — no-op.
-- ============================================================
-- (no-op)

-- ============================================================
-- 6. Verificación pre-COMMIT
-- ============================================================
SELECT 'tipo_unidad' AS columna, tipo_unidad AS valor, COUNT(*) AS n
FROM real_estate_hub."Propyte_unidades"
GROUP BY tipo_unidad ORDER BY n DESC;

SELECT 'estado_unidad' AS columna, estado_unidad AS valor, COUNT(*) AS n
FROM real_estate_hub."Propyte_unidades"
GROUP BY estado_unidad ORDER BY n DESC;

-- NO se hace COMMIT automático. El usuario revisa el SELECT post-update
-- y emite COMMIT manualmente si todo está bien, o ROLLBACK.
-- ROLLBACK;  -- descomentar si algo no cuadra
-- COMMIT;    -- descomentar si todo OK
