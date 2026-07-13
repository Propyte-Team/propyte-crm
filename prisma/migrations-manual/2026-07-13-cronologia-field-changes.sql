-- Cronología por registro (Anexo Técnico — Contactos/Deals): TODO cambio de campo en
-- contacts y deals queda en propyte_crm.record_field_changes, escrito por un trigger de
-- Postgres (atrapa los ~14 caminos de escritura: API, workflows, bot, dedup, zapier, etc.).
-- actor_id/source se enriquecen vía set_config('crm.source'/'crm.actor_id', ..., true)
-- transaccional desde la app (src/lib/audit/change-context.ts) — pueden quedar NULL si el
-- caller no los fijó; el trigger igual audita el cambio.
--
-- Además agrega 4 estados nuevos al enum ContactStatus (PERDIDO, CONTACTADO_PERDIDO,
-- REUNION, PROSPECTO).
--
-- APLICAR EN 2 ENVÍOS (ALTER TYPE ... ADD VALUE no puede correr dentro de un bloque de
-- transacción — mismo patrón que 2026-06-22-whatsapp-multicuenta.sql):
--   ENVÍO 1 = solo el paso 1 (ALTER TYPE ... ADD VALUE), commit.
--   ENVÍO 2 = pasos 2 a 5 (tabla + trigger + vistas).
-- Aditivo e idempotente: seguro de re-ejecutar.

-- ============================ ENVÍO 1 ============================
-- 1) Nuevos valores de ContactStatus (cada ADD VALUE en su propio statement; idempotente).
ALTER TYPE propyte_crm."ContactStatus" ADD VALUE IF NOT EXISTS 'PERDIDO';
ALTER TYPE propyte_crm."ContactStatus" ADD VALUE IF NOT EXISTS 'CONTACTADO_PERDIDO';
ALTER TYPE propyte_crm."ContactStatus" ADD VALUE IF NOT EXISTS 'REUNION';
ALTER TYPE propyte_crm."ContactStatus" ADD VALUE IF NOT EXISTS 'PROSPECTO';

-- ============================ ENVÍO 2 ============================

-- 2) Tabla de cronología (polimórfica: entity_type + entity_id, SIN FK — Contact/Deal
--    comparten esta tabla). id vía gen_random_uuid() porque las filas las inserta el
--    trigger (Postgres), no Prisma (Prisma nunca escribe en esta tabla).
CREATE TABLE IF NOT EXISTS propyte_crm.record_field_changes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text        NOT NULL CHECK (entity_type IN ('contact', 'deal')),
  entity_id  text        NOT NULL,
  field      text        NOT NULL,
  old_value  jsonb,
  new_value  jsonb,
  source     text,
  actor_id   text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS record_field_changes_entity_idx
  ON propyte_crm.record_field_changes (entity_type, entity_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS record_field_changes_field_idx
  ON propyte_crm.record_field_changes (entity_type, field, changed_at DESC);

-- Cierra la exposición vía anon key sin afectar al CRM (mismo criterio que
-- 2026-06-12-enable-rls.sql: Prisma/service_role tienen bypassrls=true).
ALTER TABLE propyte_crm.record_field_changes ENABLE ROW LEVEL SECURITY;

-- 3) Función genérica del trigger: compara to_jsonb(OLD) vs to_jsonb(NEW) key por key
--    (excepto updatedAt/lastActivityAt) e inserta una fila por cada campo distinto.
--    TG_ARGV[0] = entity_type ('contact' | 'deal'), fijado por cada CREATE TRIGGER.
CREATE OR REPLACE FUNCTION propyte_crm.log_field_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  excluded_keys text[] := ARRAY['updatedAt', 'lastActivityAt'];
  k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(new_row)
  LOOP
    IF k = ANY (excluded_keys) THEN
      CONTINUE;
    END IF;
    IF old_row -> k IS DISTINCT FROM new_row -> k THEN
      INSERT INTO propyte_crm.record_field_changes
        (entity_type, entity_id, field, old_value, new_value, source, actor_id)
      VALUES (
        TG_ARGV[0],
        NEW.id,
        k,
        old_row -> k,
        new_row -> k,
        nullif(current_setting('crm.source', true), ''),
        nullif(current_setting('crm.actor_id', true), '')
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- 4) Triggers AFTER UPDATE en contacts y deals (idempotentes vía DROP TRIGGER IF EXISTS).
DROP TRIGGER IF EXISTS trg_contacts_field_changes ON propyte_crm."contacts";
CREATE TRIGGER trg_contacts_field_changes
  AFTER UPDATE ON propyte_crm."contacts"
  FOR EACH ROW
  EXECUTE FUNCTION propyte_crm.log_field_changes('contact');

DROP TRIGGER IF EXISTS trg_deals_field_changes ON propyte_crm."deals";
CREATE TRIGGER trg_deals_field_changes
  AFTER UPDATE ON propyte_crm."deals"
  FOR EACH ROW
  EXECUTE FUNCTION propyte_crm.log_field_changes('deal');

-- 5) Vistas de períodos por estado — derivadas de record_field_changes, un período por
--    cambio (LEAD sobre changed_at) + período inicial (createdAt → primer cambio, con el
--    old_value de ese primer cambio) + fallback de período único para registros sin
--    ningún cambio registrado (su valor actual, abierto desde createdAt).
--    exited_at NULL = período vigente; duration = now() - entered_at en ese caso.
CREATE OR REPLACE VIEW propyte_crm.v_contact_status_periods AS
WITH changes AS (
  SELECT
    rfc.entity_id,
    (rfc.old_value #>> '{}')                                                          AS old_status,
    (rfc.new_value #>> '{}')                                                          AS new_status,
    rfc.changed_at::timestamptz                                                       AS changed_at,
    LEAD(rfc.changed_at::timestamptz) OVER (PARTITION BY rfc.entity_id ORDER BY rfc.changed_at) AS next_changed_at,
    ROW_NUMBER() OVER (PARTITION BY rfc.entity_id ORDER BY rfc.changed_at)             AS rn
  FROM propyte_crm.record_field_changes rfc
  WHERE rfc.entity_type = 'contact' AND rfc.field = 'contactStatus'
),
initial_periods AS (
  -- Período inicial: desde contacts.createdAt hasta el primer cambio, con el estado
  -- anterior a ese primer cambio (old_value).
  SELECT
    c.entity_id,
    c.old_status                    AS status,
    ct."createdAt"::timestamptz     AS entered_at,
    c.changed_at                    AS exited_at
  FROM changes c
  JOIN propyte_crm."contacts" ct ON ct.id = c.entity_id
  WHERE c.rn = 1
),
change_periods AS (
  -- Un período por cada cambio: desde el cambio hasta el siguiente (o NULL = vigente).
  SELECT
    c.entity_id,
    c.new_status        AS status,
    c.changed_at         AS entered_at,
    c.next_changed_at    AS exited_at
  FROM changes c
),
no_change_contacts AS (
  -- Contactos sin ningún cambio registrado: un solo período abierto con su valor actual.
  SELECT
    ct.id                            AS entity_id,
    ct."contactStatus"::text         AS status,
    ct."createdAt"::timestamptz      AS entered_at,
    NULL::timestamptz                AS exited_at
  FROM propyte_crm."contacts" ct
  WHERE NOT EXISTS (SELECT 1 FROM changes c WHERE c.entity_id = ct.id)
),
all_periods AS (
  SELECT * FROM initial_periods
  UNION ALL
  SELECT * FROM change_periods
  UNION ALL
  SELECT * FROM no_change_contacts
)
SELECT
  entity_id,
  status,
  entered_at,
  exited_at,
  CASE WHEN exited_at IS NULL THEN now() - entered_at ELSE exited_at - entered_at END AS duration
FROM all_periods;

CREATE OR REPLACE VIEW propyte_crm.v_deal_stage_periods AS
WITH changes AS (
  SELECT
    rfc.entity_id,
    (rfc.old_value #>> '{}')                                                          AS old_status,
    (rfc.new_value #>> '{}')                                                          AS new_status,
    rfc.changed_at::timestamptz                                                       AS changed_at,
    LEAD(rfc.changed_at::timestamptz) OVER (PARTITION BY rfc.entity_id ORDER BY rfc.changed_at) AS next_changed_at,
    ROW_NUMBER() OVER (PARTITION BY rfc.entity_id ORDER BY rfc.changed_at)             AS rn
  FROM propyte_crm.record_field_changes rfc
  WHERE rfc.entity_type = 'deal' AND rfc.field = 'stage'
),
initial_periods AS (
  SELECT
    c.entity_id,
    c.old_status                AS status,
    d."createdAt"::timestamptz  AS entered_at,
    c.changed_at                 AS exited_at
  FROM changes c
  JOIN propyte_crm."deals" d ON d.id = c.entity_id
  WHERE c.rn = 1
),
change_periods AS (
  SELECT
    c.entity_id,
    c.new_status         AS status,
    c.changed_at          AS entered_at,
    c.next_changed_at     AS exited_at
  FROM changes c
),
no_change_deals AS (
  SELECT
    d.id                        AS entity_id,
    d."stage"::text             AS status,
    d."createdAt"::timestamptz  AS entered_at,
    NULL::timestamptz           AS exited_at
  FROM propyte_crm."deals" d
  WHERE NOT EXISTS (SELECT 1 FROM changes c WHERE c.entity_id = d.id)
),
all_periods AS (
  SELECT * FROM initial_periods
  UNION ALL
  SELECT * FROM change_periods
  UNION ALL
  SELECT * FROM no_change_deals
)
SELECT
  entity_id,
  status,
  entered_at,
  exited_at,
  CASE WHEN exited_at IS NULL THEN now() - entered_at ELSE exited_at - entered_at END AS duration
FROM all_periods;
