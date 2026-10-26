-- #927 — Reclutamiento: «Ubicación» = dónde trabajará la persona o la modalidad, con las opciones de
-- Notion: Playa del Carmen, Mérida, Tulum, Cancún, Remoto, Foráneo. Cancún, Remoto y Foráneo no
-- existen en el enum "Plaza" del CRM, así que la columna pasa a TEXT (los códigos los valida la app:
-- PDC, MERIDA, TULUM, CANCUN, REMOTO, FORANEO — src/lib/reclutamiento/shared.ts).
-- Al escribirla la tabla tenía 0 filas; el USING conserva cualquier valor que ya hubiera.
-- Idempotente: si la columna ya es TEXT, no hace nada. Aplicar ANTES del despliegue y ANTES de la
-- importación de Notion (2026-10-26-reclutamiento-importar-notion.sql, que trae CANCUN/REMOTO/FORANEO).
-- NO toca el enum "Plaza" ni ninguna otra tabla.
--
-- Rollback (solo si no hay filas con CANCUN/REMOTO/FORANEO):
--   ALTER TABLE "propyte_crm"."recruit_candidates"
--     ALTER COLUMN "plaza" TYPE "propyte_crm"."Plaza" USING "plaza"::"propyte_crm"."Plaza";

DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'propyte_crm' AND table_name = 'recruit_candidates' AND column_name = 'plaza') <> 'text' THEN
    ALTER TABLE "propyte_crm"."recruit_candidates" ALTER COLUMN "plaza" TYPE TEXT USING "plaza"::text;
  END IF;
END $$;
