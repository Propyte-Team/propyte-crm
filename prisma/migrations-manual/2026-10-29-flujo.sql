-- #948 — Flujo comercial (F1–F8 del flujograma) en contactos y negocios.
--
-- Qué hace:
--   1. Crea el enum propyte_crm."Flujo" con los 8 flujos (lista única en src/lib/flujos.ts).
--   2. Agrega contacts.flujo (flujo de entrada) y deals.flujo (el de cada negocio). Nullable:
--      NULL = «Sin flujo», y la ficha lo muestra para que el asesor lo elija.
--   3. Dos disparadores BEFORE que SOLO llenan el campo cuando viene vacío (nunca pisan lo que
--      eligió un asesor). Van en la base y no en la app porque contactos y negocios se escriben
--      por muchos caminos (API, intake, bot, workflows, Zapier):
--        - contactos: al crear o al cambiar el tipo, Broker externo → F6 y Empleo → F8.
--        - negocios: al crear, Nativa (contado o financiamiento) → F5; si no, el flujo del
--          contacto. Al cambiar el tipo de operación a Nativa, si sigue vacío → F5.
--   4. Llena los casos seguros que ya existen (decisión de sistemas@, 2026-10-29):
--        contactos Broker externo → F6, contactos Empleo → F8, negocios Nativa → F5.
--      Corretaje (F1 o F2) y Masterbroker (F3 o F4) se quedan vacíos: no hay forma de saber cuál.
--      Medido en producción el 2026-10-29: 338 brokers, 109 de Empleo (+1 borrado) y 71 negocios
--      Nativa (66 contado + 5 financiamiento). Quedan 4 negocios de Corretaje sin flujo.
--
-- La cronología: el llenado del paso 4 se registra con la fuente «flujo_llenado_2026_10_29»
-- («Llenado de flujo (29-oct)» en la ficha), igual que la limpieza del 16-oct. Así queda claro
-- que lo puso la migración y no un asesor.
--
-- Aplicar vía execute_sql (o el SQL Editor) en oaijxdpevakashxshhvm ANTES de desplegar el código.
-- Es compatible con el código que hoy está en producción: ese código no nombra las columnas, y
-- una columna nullable sin default no cambia ningún INSERT ni SELECT suyo.
-- Idempotente: re-ejecutarla no hace nada nuevo (el llenado solo toca filas con flujo NULL).
-- Va en UNA transacción: o entra todo o nada.
--
-- Comprobación (después de aplicar):
--   SELECT "contactType", flujo, count(*) FROM propyte_crm.contacts GROUP BY 1, 2 ORDER BY 1, 2;
--   SELECT "dealType", flujo, count(*) FROM propyte_crm.deals GROUP BY 1, 2 ORDER BY 1, 2;
--
-- Rollback (solo con el código viejo de vuelta; se pierde el flujo guardado):
--   DROP TRIGGER IF EXISTS trg_contacts_flujo ON propyte_crm.contacts;
--   DROP TRIGGER IF EXISTS trg_deals_flujo ON propyte_crm.deals;
--   DROP FUNCTION IF EXISTS propyte_crm.flujo_de_contacto();
--   DROP FUNCTION IF EXISTS propyte_crm.flujo_de_negocio();
--   ALTER TABLE propyte_crm.contacts DROP COLUMN IF EXISTS flujo;
--   ALTER TABLE propyte_crm.deals DROP COLUMN IF EXISTS flujo;
--   DROP TYPE IF EXISTS propyte_crm."Flujo";

BEGIN;

-- ───────────────────────────── 1. enum ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'propyte_crm' AND t.typname = 'Flujo'
  ) THEN
    CREATE TYPE propyte_crm."Flujo" AS ENUM (
      'F1_CORRETAJE_VENDEDOR',
      'F2_CORRETAJE_COMPRADOR',
      'F3_CAPTACION_MB',
      'F4_MB',
      'F5_NATIVA',
      'F6_BROKER',
      'F7_INMOBILIARIA',
      'F8_EMPLEO'
    );
  END IF;
END $$;

-- ───────────────────────────── 2. columnas ─────────────────────────────
ALTER TABLE propyte_crm.contacts ADD COLUMN IF NOT EXISTS flujo propyte_crm."Flujo";
ALTER TABLE propyte_crm.deals    ADD COLUMN IF NOT EXISTS flujo propyte_crm."Flujo";

-- Mismo nombre que genera Prisma para @@index([flujo]) en Contact.
CREATE INDEX IF NOT EXISTS contacts_flujo_idx ON propyte_crm.contacts (flujo);

-- ───────────────────────────── 3. disparadores ─────────────────────────────
-- Contactos: solo si el flujo está vacío. Se dispara al crear y cuando el tipo CAMBIA de verdad (p. ej.
-- el clasificador del bot lo marca como Broker): si el asesor ya eligió un flujo, no se toca. Un
-- formulario que reenvía el mismo tipo no cuenta como cambio, así que un «Sin flujo» elegido a
-- propósito no se vuelve a llenar.
CREATE OR REPLACE FUNCTION propyte_crm.flujo_de_contacto()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.flujo IS NULL
     AND (TG_OP = 'INSERT' OR NEW."contactType" IS DISTINCT FROM OLD."contactType") THEN
    NEW.flujo := CASE NEW."contactType"::text
      WHEN 'BROKER_EXTERNO' THEN 'F6_BROKER'::propyte_crm."Flujo"
      WHEN 'EMPLEO'         THEN 'F8_EMPLEO'::propyte_crm."Flujo"
      ELSE NULL
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_flujo ON propyte_crm.contacts;
CREATE TRIGGER trg_contacts_flujo
  BEFORE INSERT OR UPDATE OF "contactType" ON propyte_crm.contacts
  FOR EACH ROW
  EXECUTE FUNCTION propyte_crm.flujo_de_contacto();

-- Negocios: solo si el flujo está vacío. Nativa es F5 sin duda; si no es Nativa, al CREAR toma el
-- flujo que tenga el contacto (al editar no se vuelve a heredar: el negocio ya tiene vida propia).
CREATE OR REPLACE FUNCTION propyte_crm.flujo_de_negocio()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.flujo IS NULL
     AND (TG_OP = 'INSERT' OR NEW."dealType" IS DISTINCT FROM OLD."dealType") THEN
    IF NEW."dealType"::text IN ('NATIVA_CONTADO', 'NATIVA_FINANCIAMIENTO') THEN
      NEW.flujo := 'F5_NATIVA'::propyte_crm."Flujo";
    ELSIF TG_OP = 'INSERT' THEN
      SELECT c.flujo INTO NEW.flujo FROM propyte_crm.contacts c WHERE c.id = NEW."contactId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_flujo ON propyte_crm.deals;
CREATE TRIGGER trg_deals_flujo
  BEFORE INSERT OR UPDATE OF "dealType" ON propyte_crm.deals
  FOR EACH ROW
  EXECUTE FUNCTION propyte_crm.flujo_de_negocio();

-- ───────────────────────────── 4. llenado de los casos seguros ─────────────────────────────
-- La fuente queda en la cronología (trg_*_field_changes la lee de crm.source).
SELECT set_config('crm.source', 'flujo_llenado_2026_10_29', true), set_config('crm.actor_id', '', true);

UPDATE propyte_crm.contacts SET flujo = 'F6_BROKER' WHERE flujo IS NULL AND "contactType" = 'BROKER_EXTERNO';
UPDATE propyte_crm.contacts SET flujo = 'F8_EMPLEO' WHERE flujo IS NULL AND "contactType" = 'EMPLEO';
UPDATE propyte_crm.deals    SET flujo = 'F5_NATIVA' WHERE flujo IS NULL AND "dealType" IN ('NATIVA_CONTADO', 'NATIVA_FINANCIAMIENTO');

COMMIT;
