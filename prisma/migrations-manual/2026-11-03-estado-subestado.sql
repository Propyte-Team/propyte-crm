-- #953 (entrega 1) — Estado + Subestado del contacto según el flujograma v0.2 de Luis, con razón de
-- salida, etapa previa, contador de reactivaciones y ticket estimado.
--
-- Qué hace:
--   1. Crea los enums propyte_crm."EstadoContacto" (16 estados) y propyte_crm."RazonSalida"
--      (razones de Perdido, Contactado perdido y Negocio Perdido). Listas únicas en src/lib/estados.ts.
--   2. Agrega a contacts: estado, subestado, "razonSalida", "razonSalidaDetalle", "fechaRecontacto",
--      "etapaPrevia", reactivaciones, "ticketEstimado", "ticketMoneda". estado NULL = «Por clasificar».
--   3. Dos funciones de validación (subestado y razón válidos para el estado) usadas en CHECKs.
--   4. Un disparador BEFORE que mantiene sincronizados el estado nuevo y el viejo ("contactStatus"),
--      para que todo lo que todavía lee o escribe el viejo (puntaje, «Hoy», reglas de flujo, el
--      bloqueo de spam, el alta de leads) siga funcionando sin cambios:
--        - si cambia estado → "contactStatus" toma su equivalente;
--        - si cambia solo "contactStatus" (código viejo) → estado toma su equivalente.
--      Además: al entrar a una salida guarda la etapa previa; al salir de una salida (reactivación)
--      suma 1 a reactivaciones y limpia la razón; «Pidió no ser contactado» prende "doNotContact".
--   5. Llena SOLO los casos 1:1 (Luis, 02-nov): Nuevo, Sin respuesta, Contactado (En conversación),
--      Reunión (Agendada), Contactado perdido, y Perdido que nunca se contactó (Zoho «Sin
--      Contactar») → Perdido · Sin respuesta tras cadencia. Los PROSPECTO (Zoho «Demo o Visita») y
--      los PERDIDO que llegaron a demo se quedan «Por clasificar»: los mueve la entrega 3 con las
--      reglas de evidencia de Luis. Los contactos borrados no se tocan.
--      Medido el 03-nov (vivos): se llenan 580 (Nuevo 221, Sin respuesta 179, Contactado 150,
--      Reunión 25, Contactado perdido 4, Perdido 1) y quedan 206 «Por clasificar» (Prospecto 175,
--      Perdido de «Demo o Visita» 31).
--
-- Las transiciones permitidas NO se validan aquí sino en la API (/api/contacts PUT), porque el
-- código viejo (reglas de flujo, spam) escribe "contactStatus" sin pasar por esa tabla y no debe
-- romperse. Aquí solo se garantiza que subestado y razón sean coherentes con el estado.
--
-- Aplicar en Supabase → SQL Editor (oaijxdpevakashxshhvm) ANTES de desplegar el código. Es
-- compatible con el código que hoy está en producción: ese código no nombra las columnas nuevas, y
-- el disparador deja "contactStatus" exactamente como lo escribe.
-- Idempotente: re-ejecutarla no hace nada nuevo. Va en UNA transacción.
--
-- Comprobación:
--   SELECT "contactStatus", estado, subestado, count(*) FROM propyte_crm.contacts
--   WHERE "deletedAt" IS NULL GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
--
-- Rollback (solo con el código viejo de vuelta; se pierde lo guardado en las columnas nuevas):
--   DROP TRIGGER IF EXISTS trg_contacts_estado ON propyte_crm.contacts;
--   DROP FUNCTION IF EXISTS propyte_crm.estado_de_contacto();
--   ALTER TABLE propyte_crm.contacts
--     DROP CONSTRAINT IF EXISTS contacts_subestado_valido,
--     DROP CONSTRAINT IF EXISTS contacts_razon_salida_valida,
--     DROP COLUMN IF EXISTS estado, DROP COLUMN IF EXISTS subestado,
--     DROP COLUMN IF EXISTS "razonSalida", DROP COLUMN IF EXISTS "razonSalidaDetalle",
--     DROP COLUMN IF EXISTS "fechaRecontacto", DROP COLUMN IF EXISTS "etapaPrevia",
--     DROP COLUMN IF EXISTS reactivaciones, DROP COLUMN IF EXISTS "ticketEstimado",
--     DROP COLUMN IF EXISTS "ticketMoneda";
--   DROP FUNCTION IF EXISTS propyte_crm.subestado_valido(propyte_crm."EstadoContacto", text);
--   DROP FUNCTION IF EXISTS propyte_crm.razon_salida_valida(propyte_crm."EstadoContacto", propyte_crm."RazonSalida");
--   DROP FUNCTION IF EXISTS propyte_crm.estado_a_legacy(propyte_crm."EstadoContacto");
--   DROP FUNCTION IF EXISTS propyte_crm.legacy_a_estado(propyte_crm."ContactStatus", propyte_crm."EstadoContacto");
--   DROP TYPE IF EXISTS propyte_crm."RazonSalida";
--   DROP TYPE IF EXISTS propyte_crm."EstadoContacto";

BEGIN;

-- ───────────────────────────── 1. enums ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'propyte_crm' AND t.typname = 'EstadoContacto'
  ) THEN
    CREATE TYPE propyte_crm."EstadoContacto" AS ENUM (
      'NUEVO',
      'SIN_RESPUESTA',
      'CONTACTADO',
      'REUNION',
      'DEMO',
      'RECORRIDO',
      'PROPUESTA',
      'APARTADO',
      'FIRMA',
      'ESCRITURA',
      'POSTVENTA',
      'PERDIDO',
      'CONTACTADO_PERDIDO',
      'NEGOCIO_PERDIDO',
      'REGISTRADO_POR_BROKER',
      'DERIVADO_A_RH'
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'propyte_crm' AND t.typname = 'RazonSalida'
  ) THEN
    CREATE TYPE propyte_crm."RazonSalida" AS ENUM (
      'DATOS_INCORRECTOS',
      'SIN_RESPUESTA_TRAS_CADENCIA',
      'DUPLICADO',
      'SPAM',
      'PROTEGIDO_POR_BROKER',
      'NO_CALIFICA',
      'NO_LE_INTERESA',
      'POSPUSO',
      'DEJO_DE_RESPONDER',
      'ELIGIO_OTRA_OPCION',
      'PRECIO',
      'FINANCIAMIENTO',
      'PRODUCTO',
      'CONFIANZA',
      'SITUACION_PERSONAL',
      'CANCELO_APARTADO',
      'NO_CONTACTAR',
      'OTRO'
    );
  END IF;
END $$;

-- ───────────────────────────── 2. columnas ─────────────────────────────
-- estado se agrega SIN default para que las filas existentes queden NULL («Por clasificar») y el
-- llenado de abajo decida; el default NUEVO se pone al final, solo para las altas nuevas.
ALTER TABLE propyte_crm.contacts
  ADD COLUMN IF NOT EXISTS estado               propyte_crm."EstadoContacto",
  ADD COLUMN IF NOT EXISTS subestado            text,
  ADD COLUMN IF NOT EXISTS "razonSalida"        propyte_crm."RazonSalida",
  ADD COLUMN IF NOT EXISTS "razonSalidaDetalle" text,
  ADD COLUMN IF NOT EXISTS "fechaRecontacto"    date,
  ADD COLUMN IF NOT EXISTS "etapaPrevia"        propyte_crm."EstadoContacto",
  ADD COLUMN IF NOT EXISTS reactivaciones       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "ticketEstimado"     numeric(14, 2),
  ADD COLUMN IF NOT EXISTS "ticketMoneda"       propyte_crm."Currency" NOT NULL DEFAULT 'MXN';

-- Mismo nombre que genera Prisma para @@index([estado]) en Contact.
CREATE INDEX IF NOT EXISTS contacts_estado_idx ON propyte_crm.contacts (estado);

-- ───────────────────────────── 3. funciones ─────────────────────────────
-- Subestados del contacto por estado (pestaña «Subestados v0.2»). Las salidas no llevan subestado:
-- llevan razón. NULL siempre es válido (no todos los estados tienen subestado).
CREATE OR REPLACE FUNCTION propyte_crm.subestado_valido(e propyte_crm."EstadoContacto", s text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT s IS NULL OR CASE e::text
    WHEN 'CONTACTADO' THEN s IN ('EN_CONVERSACION', 'SEGUIMIENTO_AGENDADO')
    WHEN 'REUNION'    THEN s IN ('AGENDADA', 'CONFIRMADA', 'NO_SHOW')
    WHEN 'DEMO'       THEN s IN ('REALIZADA', 'COTIZANDO', 'PRESENTACION_EQUIPO_AGENDADA', 'PRESENTACION_EQUIPO_REALIZADA')
    WHEN 'RECORRIDO'  THEN s IN ('AGENDADO', 'CONFIRMADO', 'NO_SHOW', 'COMPLETADO')
    WHEN 'PROPUESTA'  THEN s IN ('ENVIADA', 'EN_NEGOCIACION', 'ACEPTADA', 'PAQUETE_ACTIVO')
    WHEN 'APARTADO'   THEN s IN ('PENDIENTE_DE_PAGO', 'PAGADO', 'DOCUMENTOS_EN_REVISION', 'FINANCIAMIENTO_EN_TRAMITE', 'FINANCIAMIENTO_APROBADO')
    WHEN 'FIRMA'      THEN s IN ('AGENDADA', 'FIRMADO', 'DEVENGO_ACTIVO')
    WHEN 'ESCRITURA'  THEN s IN ('EN_TRAMITE_NOTARIAL', 'FECHA_AGENDADA', 'ESCRITURADO')
    WHEN 'POSTVENTA'  THEN s IN ('ENTREGA_PENDIENTE', 'ENTREGADA', 'ENCUESTA_RESPONDIDA')
    ELSE false
  END;
$$;

-- Razones de salida por estado (anexo de Luis, 02-nov). NULL es válido: las salidas que llegan por el
-- código viejo ("contactStatus") no traen razón, y la entrega 3 pide al asesor que la elija.
CREATE OR REPLACE FUNCTION propyte_crm.razon_salida_valida(e propyte_crm."EstadoContacto", r propyte_crm."RazonSalida")
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT r IS NULL OR CASE e::text
    WHEN 'PERDIDO' THEN r::text IN ('DATOS_INCORRECTOS', 'SIN_RESPUESTA_TRAS_CADENCIA', 'DUPLICADO', 'SPAM', 'PROTEGIDO_POR_BROKER', 'OTRO')
    WHEN 'CONTACTADO_PERDIDO' THEN r::text IN ('NO_CALIFICA', 'NO_LE_INTERESA', 'POSPUSO', 'DEJO_DE_RESPONDER', 'NO_CONTACTAR', 'OTRO')
    WHEN 'NEGOCIO_PERDIDO' THEN r::text IN ('ELIGIO_OTRA_OPCION', 'PRECIO', 'FINANCIAMIENTO', 'PRODUCTO', 'CONFIANZA', 'POSPUSO', 'SITUACION_PERSONAL', 'DEJO_DE_RESPONDER', 'CANCELO_APARTADO', 'NO_CONTACTAR', 'OTRO')
    ELSE false
  END;
$$;

-- Estado nuevo → estado viejo. Lo que el viejo no distingue cae en su pariente más cercano:
-- Demo a Postventa → PROSPECTO (Zoho «Demo o Visita»), Negocio Perdido → PERDIDO, Derivado a RH →
-- DESCARTADO (puntaje 0, fuera de «Hoy»), Registrado por broker → PROSPECTO (no es «Nuevo»: no
-- lleva tareas de contacto).
CREATE OR REPLACE FUNCTION propyte_crm.estado_a_legacy(e propyte_crm."EstadoContacto")
RETURNS propyte_crm."ContactStatus"
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (CASE e::text
    WHEN 'NUEVO'                 THEN 'NUEVO'
    WHEN 'SIN_RESPUESTA'         THEN 'SIN_RESPUESTA'
    WHEN 'CONTACTADO'            THEN 'CONTACTADO'
    WHEN 'REUNION'               THEN 'REUNION'
    WHEN 'DEMO'                  THEN 'PROSPECTO'
    WHEN 'RECORRIDO'             THEN 'PROSPECTO'
    WHEN 'PROPUESTA'             THEN 'PROSPECTO'
    WHEN 'APARTADO'              THEN 'PROSPECTO'
    WHEN 'FIRMA'                 THEN 'PROSPECTO'
    WHEN 'ESCRITURA'             THEN 'PROSPECTO'
    WHEN 'POSTVENTA'             THEN 'PROSPECTO'
    WHEN 'PERDIDO'               THEN 'PERDIDO'
    WHEN 'CONTACTADO_PERDIDO'    THEN 'CONTACTADO_PERDIDO'
    WHEN 'NEGOCIO_PERDIDO'       THEN 'PERDIDO'
    WHEN 'REGISTRADO_POR_BROKER' THEN 'PROSPECTO'
    WHEN 'DERIVADO_A_RH'         THEN 'DESCARTADO'
  END)::propyte_crm."ContactStatus";
$$;

-- Estado viejo → estado nuevo, para lo que todavía escribe "contactStatus". Si el estado actual ya
-- corresponde a ese valor viejo (p. ej. está en Propuesta y le escriben PROSPECTO), no se toca.
CREATE OR REPLACE FUNCTION propyte_crm.legacy_a_estado(cs propyte_crm."ContactStatus", actual propyte_crm."EstadoContacto")
RETURNS propyte_crm."EstadoContacto"
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN actual IS NOT NULL AND propyte_crm.estado_a_legacy(actual) = cs THEN actual
    ELSE (CASE cs::text
      WHEN 'NUEVO'              THEN 'NUEVO'
      WHEN 'SIN_RESPUESTA'      THEN 'SIN_RESPUESTA'
      WHEN 'CONTACTADO'         THEN 'CONTACTADO'
      WHEN 'EN_SEGUIMIENTO'     THEN 'CONTACTADO'
      WHEN 'REUNION'            THEN 'REUNION'
      WHEN 'PROSPECTO'          THEN 'DEMO'
      WHEN 'PERDIDO'            THEN 'PERDIDO'
      WHEN 'CONTACTADO_PERDIDO' THEN 'CONTACTADO_PERDIDO'
      WHEN 'DESCARTADO'         THEN 'PERDIDO'
    END)::propyte_crm."EstadoContacto"
  END;
$$;

-- ───────────────────────────── 4. disparador ─────────────────────────────
CREATE OR REPLACE FUNCTION propyte_crm.estado_de_contacto()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  salidas  propyte_crm."EstadoContacto"[] := ARRAY['PERDIDO', 'CONTACTADO_PERDIDO', 'NEGOCIO_PERDIDO']::propyte_crm."EstadoContacto"[];
  anterior propyte_crm."EstadoContacto";
  desde_viejo boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    anterior := NULL;
    IF NEW.estado IS NOT NULL AND NEW.estado <> 'NUEVO' THEN
      NEW."contactStatus" := propyte_crm.estado_a_legacy(NEW.estado);
    ELSIF NEW."contactStatus" IS DISTINCT FROM 'NUEVO' THEN
      NEW.estado := propyte_crm.legacy_a_estado(NEW."contactStatus", NULL);
      desde_viejo := true;
    END IF;
  ELSE
    anterior := OLD.estado;
    IF NEW.estado IS DISTINCT FROM OLD.estado THEN
      -- Lo cambió el código nuevo: el viejo lo sigue. Quitar el estado («Por clasificar») no toca el viejo.
      IF NEW.estado IS NOT NULL THEN
        NEW."contactStatus" := propyte_crm.estado_a_legacy(NEW.estado);
      END IF;
    ELSIF NEW."contactStatus" IS DISTINCT FROM OLD."contactStatus" THEN
      -- Lo cambió el código viejo: el nuevo lo sigue.
      NEW.estado := propyte_crm.legacy_a_estado(NEW."contactStatus", OLD.estado);
      desde_viejo := NEW.estado IS DISTINCT FROM OLD.estado;
    END IF;
  END IF;

  -- Subestado y razón que trae el valor viejo cuando el cambio vino por "contactStatus".
  IF desde_viejo THEN
    NEW.subestado := CASE NEW."contactStatus"::text
      WHEN 'CONTACTADO'     THEN 'EN_CONVERSACION'
      WHEN 'EN_SEGUIMIENTO' THEN 'SEGUIMIENTO_AGENDADO'
      WHEN 'REUNION'        THEN 'AGENDADA'
      WHEN 'PROSPECTO'      THEN 'REALIZADA'
      ELSE NULL
    END;
    IF NEW."contactStatus" = 'DESCARTADO' THEN
      NEW."razonSalida" := 'SPAM';
    END IF;
  END IF;

  IF NEW.estado IS DISTINCT FROM anterior THEN
    IF NEW.estado = ANY (salidas) THEN
      -- Entró a una salida: guarda de dónde venía (si venía de otra salida, conserva la etapa previa).
      IF anterior IS NULL OR NOT (anterior = ANY (salidas)) THEN
        NEW."etapaPrevia" := anterior;
      END IF;
    ELSE
      -- Reactivación: de una salida a un estado activo.
      IF anterior = ANY (salidas) AND NEW.estado IS NOT NULL THEN
        NEW.reactivaciones := COALESCE(OLD.reactivaciones, 0) + 1;
      END IF;
      NEW."razonSalida" := NULL;
      NEW."razonSalidaDetalle" := NULL;
      NEW."fechaRecontacto" := NULL;
      NEW."etapaPrevia" := NULL;
    END IF;
    IF NOT propyte_crm.subestado_valido(NEW.estado, NEW.subestado) THEN
      NEW.subestado := NULL;
    END IF;
    IF NOT propyte_crm.razon_salida_valida(NEW.estado, NEW."razonSalida") THEN
      NEW."razonSalida" := NULL;
    END IF;
  END IF;

  IF NEW."razonSalida" = 'NO_CONTACTAR' THEN
    NEW."doNotContact" := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_estado ON propyte_crm.contacts;
CREATE TRIGGER trg_contacts_estado
  BEFORE INSERT OR UPDATE OF estado, "contactStatus", subestado, "razonSalida" ON propyte_crm.contacts
  FOR EACH ROW
  EXECUTE FUNCTION propyte_crm.estado_de_contacto();

-- CHECKs: el disparador corre antes, así que solo rechazan escrituras incoherentes que no cambian
-- el estado (p. ej. un subestado de Reunión en un contacto que está en Demo).
ALTER TABLE propyte_crm.contacts DROP CONSTRAINT IF EXISTS contacts_subestado_valido;
ALTER TABLE propyte_crm.contacts
  ADD CONSTRAINT contacts_subestado_valido CHECK (propyte_crm.subestado_valido(estado, subestado));
ALTER TABLE propyte_crm.contacts DROP CONSTRAINT IF EXISTS contacts_razon_salida_valida;
ALTER TABLE propyte_crm.contacts
  ADD CONSTRAINT contacts_razon_salida_valida CHECK (propyte_crm.razon_salida_valida(estado, "razonSalida"));

-- ───────────────────────────── 5. llenado de los casos 1:1 ─────────────────────────────
-- La fuente queda en la cronología («Llenado de estado (#953)»).
SELECT set_config('crm.source', 'estado_llenado_953', true), set_config('crm.actor_id', '', true);

UPDATE propyte_crm.contacts
SET estado = (CASE "contactStatus"::text
      WHEN 'NUEVO'              THEN 'NUEVO'
      WHEN 'SIN_RESPUESTA'      THEN 'SIN_RESPUESTA'
      WHEN 'CONTACTADO'         THEN 'CONTACTADO'
      WHEN 'EN_SEGUIMIENTO'     THEN 'CONTACTADO'
      WHEN 'REUNION'            THEN 'REUNION'
      WHEN 'CONTACTADO_PERDIDO' THEN 'CONTACTADO_PERDIDO'
    END)::propyte_crm."EstadoContacto",
    subestado = CASE "contactStatus"::text
      WHEN 'CONTACTADO'     THEN 'EN_CONVERSACION'
      WHEN 'EN_SEGUIMIENTO' THEN 'SEGUIMIENTO_AGENDADO'
      WHEN 'REUNION'        THEN 'AGENDADA'
      ELSE NULL
    END
WHERE estado IS NULL
  AND "deletedAt" IS NULL
  AND "contactStatus"::text IN ('NUEVO', 'SIN_RESPUESTA', 'CONTACTADO', 'EN_SEGUIMIENTO', 'REUNION', 'CONTACTADO_PERDIDO');

-- Perdido que nunca se contactó (Zoho «Sin Contactar»): terminó la cadencia de nuevos sin respuesta.
UPDATE propyte_crm.contacts
SET estado = 'PERDIDO', "razonSalida" = 'SIN_RESPUESTA_TRAS_CADENCIA'
WHERE estado IS NULL
  AND "deletedAt" IS NULL
  AND "contactStatus" = 'PERDIDO'
  AND "internalStage" = 'Sin Contactar';

-- Descartado (spam marcado desde el Inbox) → Perdido · Spam.
UPDATE propyte_crm.contacts
SET estado = 'PERDIDO', "razonSalida" = 'SPAM'
WHERE estado IS NULL
  AND "deletedAt" IS NULL
  AND "contactStatus" = 'DESCARTADO';

-- Altas nuevas: Nuevo (el disparador lo cambia si el código viejo manda otro "contactStatus").
ALTER TABLE propyte_crm.contacts ALTER COLUMN estado SET DEFAULT 'NUEVO';

COMMIT;
