-- #984 — Los contactos de Empleo (F8) pasan solos a «Derivado a RH».
--
-- La migración #958 movió a los 111 que había, pero un contacto que entra (o queda) como Empleo
-- después se quedaba en Nuevo: aparecía como Tibio y entraría a las tareas de ventas. Regla de Luis:
-- F8 → Derivado a RH, fuera de Copilot.
--
-- Qué hace:
--   1. Disparador trg_contacts_rh_empleo (BEFORE INSERT OR UPDATE OF "contactType", flujo): cuando
--      el contacto es Empleo (tipo EMPLEO o flujo F8) y está en Nuevo, Sin respuesta o sin estado, lo
--      pasa a Derivado a RH (y su estado viejo a DESCARTADO, como hace el #953). Si alguien ya lo llevó
--      a otro estado (Contactado, Reunión…), no lo toca. En un UPDATE solo actúa si el tipo o el flujo
--      cambiaron. Su ficha de Reclutamiento (#959) no cambia.
--      Corre después de trg_contacts_estado y de trg_contacts_flujo (orden alfabético de los BEFORE),
--      así ve el flujo F8 que pone trg_contacts_flujo cuando el tipo es Empleo.
--   2. Mueve los que ya están así (1 contacto el 05-nov). En la cronología: «Derivado a RH automático (#984)».
--
-- No depende del código. Idempotente. Va en UNA transacción.
-- Aplicar en Supabase → SQL Editor (oaijxdpevakashxshhvm).
--
-- Comprobación:
--   SELECT count(*) FROM propyte_crm.contacts WHERE "deletedAt" IS NULL
--     AND ("contactType" = 'EMPLEO' OR flujo = 'F8_EMPLEO') AND estado IN ('NUEVO','SIN_RESPUESTA');   -- 0
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_contacts_rh_empleo ON propyte_crm.contacts;
--   DROP FUNCTION IF EXISTS propyte_crm.empleo_a_rh();

BEGIN;

CREATE OR REPLACE FUNCTION propyte_crm.empleo_a_rh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW."contactType" IS NOT DISTINCT FROM OLD."contactType"
     AND NEW.flujo IS NOT DISTINCT FROM OLD.flujo THEN
    RETURN NEW;
  END IF;
  IF (NEW."contactType"::text = 'EMPLEO' OR NEW.flujo::text = 'F8_EMPLEO')
     AND (NEW.estado IS NULL OR NEW.estado IN ('NUEVO', 'SIN_RESPUESTA')) THEN
    NEW.estado := 'DERIVADO_A_RH';
    NEW.subestado := NULL;
    NEW."contactStatus" := propyte_crm.estado_a_legacy('DERIVADO_A_RH');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_rh_empleo ON propyte_crm.contacts;
CREATE TRIGGER trg_contacts_rh_empleo
  BEFORE INSERT OR UPDATE OF "contactType", flujo ON propyte_crm.contacts
  FOR EACH ROW
  EXECUTE FUNCTION propyte_crm.empleo_a_rh();

-- Los que ya están así. updatedAt para que la temperatura (#973) los recalcule en el siguiente minuto.
SELECT set_config('crm.source', 'empleo_a_rh_984', true), set_config('crm.actor_id', '', true);
UPDATE propyte_crm.contacts
   SET estado = 'DERIVADO_A_RH', subestado = NULL, "updatedAt" = now()
 WHERE "deletedAt" IS NULL
   AND ("contactType"::text = 'EMPLEO' OR flujo::text = 'F8_EMPLEO')
   AND estado IN ('NUEVO', 'SIN_RESPUESTA');

COMMIT;
