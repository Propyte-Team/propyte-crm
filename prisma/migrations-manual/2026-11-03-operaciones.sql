-- #957 (entrega 2 de #953) — Operaciones en lugar de Negocios.
--
-- Qué hace:
--   1. Crea los enums propyte_crm."TipoOperacion", "EtapaOperacion" y "FormaPago" (listas únicas en
--      src/lib/operaciones.ts).
--   2. Agrega a deals: "tipoOperacion", etapa, subestado, reapartados, "formaPago", "contratoFirmado",
--      "enganchePagado", "vigenciaHasta", "porcentajeComision", "nivelMb", "propiedadDescripcion".
--      etapa NULL = negocio de antes del #957 (anterior al apartado): lo mueve la #958.
--   3. CHECK: el subestado tiene que ser de la etapa (mismos subestados del flujograma v0.2 para
--      Apartado, Firma, Escritura y Postventa); nivelMb solo MB1, MB2 o MB3.
--   4. Disparador AFTER en deals: el estado del contacto muestra su operación activa más avanzada
--      (Escritura > Firma > Apartado, y Postventa solo si no hay otra compra en curso), con el subestado
--      de la operación. Si se cancela la última operación activa → Negocio Perdido · Canceló apartado.
--   5. Llena los 35 negocios ganados (Nativa, firmados 2022–2025, sin escritura ni entrega
--      registradas): Venta · Firma · Firmado, con Contrato firmado (decisión de sistemas@, 03-nov). Su
--      etapa vieja se queda en WON: comisiones, metas y reportes no cambian. Sus 32 contactos pasan a
--      Firma · Firmado (30 estaban «Por clasificar» y 2 en Contactado).
--
-- La etapa vieja ("stage") la sigue escribiendo la API a partir de la etapa nueva (lib/operaciones.ts),
-- para que se apliquen las reglas de siempre: unidad para apartar, hold del Hub, inventario y cálculo
-- de comisión al ganar. Por eso aquí no hay disparador de etapa vieja.
--
-- Aplicar en Supabase → SQL Editor (oaijxdpevakashxshhvm) ANTES de desplegar el código. Requiere la
-- migración del #953 (2026-11-03-estado-subestado.sql), que ya está en producción. Es compatible con el
-- código actual: ese código no nombra las columnas nuevas.
-- Idempotente. Va en UNA transacción.
--
-- Comprobación:
--   SELECT stage, "tipoOperacion", etapa, subestado, count(*) FROM propyte_crm.deals
--   WHERE "deletedAt" IS NULL GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4;
--   SELECT estado, subestado, count(*) FROM propyte_crm.contacts
--   WHERE "deletedAt" IS NULL AND estado IN ('APARTADO','FIRMA','ESCRITURA','POSTVENTA') GROUP BY 1, 2;
--
-- Rollback (solo con el código viejo de vuelta; los contactos que pasaron a Firma se quedan ahí):
--   DROP TRIGGER IF EXISTS trg_deals_estado_contacto ON propyte_crm.deals;
--   DROP FUNCTION IF EXISTS propyte_crm.estado_desde_operaciones();
--   ALTER TABLE propyte_crm.deals
--     DROP CONSTRAINT IF EXISTS deals_subestado_valido, DROP CONSTRAINT IF EXISTS deals_nivel_mb_valido,
--     DROP COLUMN IF EXISTS "tipoOperacion", DROP COLUMN IF EXISTS etapa, DROP COLUMN IF EXISTS subestado,
--     DROP COLUMN IF EXISTS reapartados, DROP COLUMN IF EXISTS "formaPago",
--     DROP COLUMN IF EXISTS "contratoFirmado", DROP COLUMN IF EXISTS "enganchePagado",
--     DROP COLUMN IF EXISTS "vigenciaHasta", DROP COLUMN IF EXISTS "porcentajeComision",
--     DROP COLUMN IF EXISTS "nivelMb", DROP COLUMN IF EXISTS "propiedadDescripcion";
--   DROP FUNCTION IF EXISTS propyte_crm.operacion_subestado_valido(propyte_crm."EtapaOperacion", text);
--   DROP TYPE IF EXISTS propyte_crm."FormaPago";
--   DROP TYPE IF EXISTS propyte_crm."EtapaOperacion";
--   DROP TYPE IF EXISTS propyte_crm."TipoOperacion";

BEGIN;

-- ───────────────────────────── 1. enums ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'propyte_crm' AND t.typname = 'TipoOperacion') THEN
    CREATE TYPE propyte_crm."TipoOperacion" AS ENUM (
      'VENTA',
      'CONTRATO_INTERMEDIACION',
      'CONTRATO_MB',
      'CONVENIO_ALIADO'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'propyte_crm' AND t.typname = 'EtapaOperacion') THEN
    CREATE TYPE propyte_crm."EtapaOperacion" AS ENUM (
      'EN_PREPARACION',
      'APARTADO',
      'FIRMA',
      'ESCRITURA',
      'POSTVENTA',
      'CANCELADA'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'propyte_crm' AND t.typname = 'FormaPago') THEN
    CREATE TYPE propyte_crm."FormaPago" AS ENUM (
      'CONTADO',
      'CREDITO_BANCARIO',
      'FINANCIAMIENTO_DIRECTO'
    );
  END IF;
END $$;

-- ───────────────────────────── 2. columnas ─────────────────────────────
ALTER TABLE propyte_crm.deals
  ADD COLUMN IF NOT EXISTS "tipoOperacion"        propyte_crm."TipoOperacion",
  ADD COLUMN IF NOT EXISTS etapa                  propyte_crm."EtapaOperacion",
  ADD COLUMN IF NOT EXISTS subestado              text,
  ADD COLUMN IF NOT EXISTS reapartados            integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "formaPago"            propyte_crm."FormaPago",
  ADD COLUMN IF NOT EXISTS "contratoFirmado"      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "enganchePagado"       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "vigenciaHasta"        date,
  ADD COLUMN IF NOT EXISTS "porcentajeComision"   numeric(5, 2),
  ADD COLUMN IF NOT EXISTS "nivelMb"              text,
  ADD COLUMN IF NOT EXISTS "propiedadDescripcion" text;

-- Mismo nombre que genera Prisma para @@index([etapa]) en Deal.
CREATE INDEX IF NOT EXISTS deals_etapa_idx ON propyte_crm.deals (etapa);

-- ───────────────────────────── 3. validación ─────────────────────────────
-- Los subestados de las etapas activas son los del estado del contacto con el mismo nombre
-- (propyte_crm.subestado_valido, de la migración del #953). En preparación y Cancelada no llevan.
CREATE OR REPLACE FUNCTION propyte_crm.operacion_subestado_valido(e propyte_crm."EtapaOperacion", s text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT s IS NULL OR CASE
    WHEN e::text IN ('APARTADO', 'FIRMA', 'ESCRITURA', 'POSTVENTA')
      THEN propyte_crm.subestado_valido(e::text::propyte_crm."EstadoContacto", s)
    ELSE false
  END;
$$;

ALTER TABLE propyte_crm.deals DROP CONSTRAINT IF EXISTS deals_subestado_valido;
ALTER TABLE propyte_crm.deals
  ADD CONSTRAINT deals_subestado_valido CHECK (propyte_crm.operacion_subestado_valido(etapa, subestado));
ALTER TABLE propyte_crm.deals DROP CONSTRAINT IF EXISTS deals_nivel_mb_valido;
ALTER TABLE propyte_crm.deals
  ADD CONSTRAINT deals_nivel_mb_valido CHECK ("nivelMb" IS NULL OR "nivelMb" IN ('MB1', 'MB2', 'MB3'));

-- ───────────────────────────── 4. estado del contacto ─────────────────────────────
CREATE OR REPLACE FUNCTION propyte_crm.estado_desde_operaciones()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  contacto text := NEW."contactId";
  mejor_etapa propyte_crm."EtapaOperacion";
  mejor_sub text;
  hay_activa boolean;
  estado_actual propyte_crm."EstadoContacto";
  sub_actual text;
BEGIN
  -- La operación activa más avanzada. Postventa es el fin del flujo: si el cliente ya empezó otra
  -- compra, manda la compra en curso (Luis, 02-nov).
  SELECT d.etapa, d.subestado INTO mejor_etapa, mejor_sub
  FROM propyte_crm.deals d
  WHERE d."contactId" = contacto
    AND d."deletedAt" IS NULL
    AND d.etapa IN ('APARTADO', 'FIRMA', 'ESCRITURA', 'POSTVENTA')
  ORDER BY CASE d.etapa::text WHEN 'ESCRITURA' THEN 3 WHEN 'FIRMA' THEN 2 WHEN 'APARTADO' THEN 1 ELSE 0 END DESC,
           d."updatedAt" DESC
  LIMIT 1;
  hay_activa := FOUND;

  SELECT c.estado, c.subestado INTO estado_actual, sub_actual
  FROM propyte_crm.contacts c WHERE c.id = contacto;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF hay_activa THEN
    IF estado_actual IS DISTINCT FROM mejor_etapa::text::propyte_crm."EstadoContacto"
       OR sub_actual IS DISTINCT FROM mejor_sub THEN
      UPDATE propyte_crm.contacts
      SET estado = mejor_etapa::text::propyte_crm."EstadoContacto", subestado = mejor_sub
      WHERE id = contacto;
    END IF;
  ELSIF TG_OP = 'UPDATE'
        AND NEW.etapa = 'CANCELADA' AND OLD.etapa IS DISTINCT FROM 'CANCELADA'
        AND estado_actual::text IN ('APARTADO', 'FIRMA', 'ESCRITURA', 'POSTVENTA') THEN
    -- Se canceló la última operación activa: el contacto sale a Negocio Perdido.
    UPDATE propyte_crm.contacts
    SET estado = 'NEGOCIO_PERDIDO', "razonSalida" = 'CANCELO_APARTADO'
    WHERE id = contacto;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_estado_contacto ON propyte_crm.deals;
CREATE TRIGGER trg_deals_estado_contacto
  AFTER INSERT OR UPDATE OF etapa, subestado, "deletedAt" ON propyte_crm.deals
  FOR EACH ROW
  EXECUTE FUNCTION propyte_crm.estado_desde_operaciones();

-- ───────────────────────────── 5. llenado de los ganados ─────────────────────────────
-- La fuente queda en la cronología del negocio y del contacto («Llenado de operaciones (#957)»).
SELECT set_config('crm.source', 'operaciones_llenado_957', true), set_config('crm.actor_id', '', true);

UPDATE propyte_crm.deals
SET "tipoOperacion" = 'VENTA',
    etapa = 'FIRMA',
    subestado = 'FIRMADO',
    "contratoFirmado" = true,
    "formaPago" = CASE "dealType"::text
      WHEN 'NATIVA_CONTADO'        THEN 'CONTADO'::propyte_crm."FormaPago"
      WHEN 'NATIVA_FINANCIAMIENTO' THEN 'FINANCIAMIENTO_DIRECTO'::propyte_crm."FormaPago"
      ELSE NULL
    END
WHERE etapa IS NULL
  AND "deletedAt" IS NULL
  AND stage = 'WON';

COMMIT;
