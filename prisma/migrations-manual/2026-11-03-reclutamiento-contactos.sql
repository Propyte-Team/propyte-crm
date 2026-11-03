-- #959 — Reclutamiento y Contactos ligados en los dos sentidos.
--
-- Problema (medido en prod el 03-nov):
--   · Los 152 candidatos de Reclutamiento (importados de Notion en el #927) no tenían contacto: no
--     salían en Contactos. Ninguno coincidía por correo ni teléfono con un contacto existente.
--   · Los 109 contactos de tipo Empleo (108 de la importación de Zoho de octubre) no tenían ficha en
--     Reclutamiento. Solo el bot de reclutamiento creaba la ficha, y solo para quien habla con él.
--
-- Qué hace:
--   1. LLENADO Reclutamiento → Contactos. Cada candidato vivo sin contacto:
--        a. se liga a un contacto vivo que tenga su mismo correo o los mismos 10 últimos dígitos del
--           teléfono (si ese contacto no tiene ya ficha). Si el contacto no tenía tipo, queda Empleo;
--           un tipo puesto por alguien no se cambia.
--        b. si no hay ninguno, se crea un contacto tipo Empleo en estado «Derivado a RH» (decisión del
--           03-nov: no entra al embudo de ventas), con la etiqueta `reclutamiento-2026-11`, origen
--           «Otro · Reclutamiento (…)», el área como puesto solicitado, y la ubicación como plaza
--           cuando es una plaza del CRM (PDC, Tulum, Mérida). Va por SQL directo: no dispara flujos,
--           cadencias ni mensajes de bienvenida, y queda sin asesor asignado.
--   2. LLENADO Contactos → Reclutamiento. Cada contacto vivo tipo Empleo sin ficha recibe una en
--      «1 · Recibido», con origen CONTACTO y la fecha de alta del contacto. Su estado del contacto
--      («Sin respuesta», «Contactado»…) se ve como etiqueta en la tabla de Reclutamiento (código).
--   3. DISPARADOR en contacts, de aquí en adelante, por cualquier vía (bot, edición manual,
--      importación, formulario, API):
--        · el contacto pasa a Empleo (o nace Empleo)  → ficha en «1 · Recibido» ligada a él;
--        · el contacto deja de ser Empleo              → su ficha pasa a «X · Descartado» con una nota
--          (decisión del 03-nov) y guarda en "stagePrevia" la etapa en que estaba. Las fichas en
--          Contratado o ya descartadas no se tocan;
--        · vuelve a ser Empleo (p. ej. el bot lo reclasificó de ida y vuelta) → si ese descarte fue
--          automático, la ficha regresa a la etapa que tenía, con nota;
--        · el contacto se fusiona con otro             → la ficha pasa al contacto que sobrevive, si
--          ese no tiene ya una.
--      Si el contacto ya tiene ficha (incluso borrada a mano en Reclutamiento) no se crea otra: el
--      índice único de "contactId" lo impide y el borrado de RH se respeta.
--
-- Va en UNA transacción y es idempotente: correrla dos veces no crea nada nuevo.
-- Compatible con el código que hoy está en producción. El alta manual de hoy (sin el código de este
-- PR) sigue creando la ficha sin contacto; por eso conviene desplegar el código el mismo día.
--
-- Aplicar en Supabase → SQL Editor (oaijxdpevakashxshhvm) ANTES de desplegar el código.
--
-- Comprobación:
--   SELECT
--     (SELECT count(*) FROM propyte_crm.recruit_candidates WHERE "deletedAt" IS NULL AND "contactId" IS NULL) AS fichas_sin_contacto,  -- 0
--     (SELECT count(*) FROM propyte_crm.contacts c WHERE c."contactType" = 'EMPLEO' AND c."deletedAt" IS NULL AND c."mergedIntoId" IS NULL
--        AND NOT EXISTS (SELECT 1 FROM propyte_crm.recruit_candidates r WHERE r."contactId" = c.id)) AS empleo_sin_ficha,          -- 0
--     (SELECT count(*) FROM propyte_crm.contacts WHERE 'reclutamiento-2026-11' = ANY(tags)) AS contactos_creados,                     -- 152
--     (SELECT count(*) FROM propyte_crm.recruit_candidates WHERE source = 'CONTACTO') AS fichas_creadas;                             -- 109
--
-- Rollback (pensado para correrse poco después de aplicarla). Los contactos creados se BORRAN
-- LÓGICAMENTE (deletedAt), no físicamente: para entonces ya pueden tener conversaciones, notas o
-- archivos que los referencian. Los ligados del paso 1a a contactos que ya existían no se deshacen
-- (en prod fueron 0 el 03-nov):
--   BEGIN;
--   DROP TRIGGER IF EXISTS trg_contacts_reclutamiento ON propyte_crm.contacts;
--   DROP FUNCTION IF EXISTS propyte_crm.reclutamiento_de_contacto();
--   UPDATE propyte_crm.recruit_candidates SET "contactId" = NULL
--    WHERE "contactId" IN (SELECT id FROM propyte_crm.contacts WHERE 'reclutamiento-2026-11' = ANY(tags));
--   UPDATE propyte_crm.contacts SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
--    WHERE 'reclutamiento-2026-11' = ANY(tags) AND "deletedAt" IS NULL;
--   UPDATE propyte_crm.recruit_candidates SET "deletedAt" = CURRENT_TIMESTAMP
--    WHERE source = 'CONTACTO' AND "deletedAt" IS NULL;
--   ALTER TABLE propyte_crm.recruit_candidates DROP COLUMN IF EXISTS "stagePrevia";
--   COMMIT;

BEGIN;

-- La cronología firma los cambios de tipo del paso 1a como este llenado.
SELECT set_config('crm.source', 'reclutamiento_llenado_959', true), set_config('crm.actor_id', '', true);

-- Mientras se llena, el disparador no debe existir: el paso 1b crea contactos Empleo que ya
-- traen su ficha y no deben recibir otra. Se vuelve a crear al final.
DROP TRIGGER IF EXISTS trg_contacts_reclutamiento ON propyte_crm.contacts;

-- Etapa en que estaba la ficha cuando el disparador la descartó porque el contacto dejó de ser
-- Empleo. Si vuelve a ser Empleo, regresa ahí. NULL = no hay descarte automático pendiente
-- (cualquier cambio de etapa desde la pantalla la limpia).
ALTER TABLE propyte_crm.recruit_candidates ADD COLUMN IF NOT EXISTS "stagePrevia" TEXT;

-- ---------------------------------------------------------------------------------------------
-- 1a. Candidatos sin contacto → contacto existente con el mismo correo o teléfono.
-- ---------------------------------------------------------------------------------------------
CREATE TEMP TABLE _ligados ON COMMIT DROP AS
WITH cand AS (
  SELECT r.id,
         lower(btrim(coalesce(r.email, ''))) AS em,
         right(regexp_replace(coalesce(r.phone, ''), '\D', '', 'g'), 10) AS ph,
         r."createdAt"
    FROM propyte_crm.recruit_candidates r
   WHERE r."contactId" IS NULL AND r."deletedAt" IS NULL
),
par AS (
  SELECT DISTINCT ON (cand.id) cand.id AS cand_id, c.id AS contact_id, cand."createdAt"
    FROM cand
    JOIN propyte_crm.contacts c
      ON c."deletedAt" IS NULL AND c."mergedIntoId" IS NULL
     AND (   (cand.em <> '' AND lower(btrim(coalesce(c.email, ''))) = cand.em)
          OR (length(cand.ph) = 10 AND right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = cand.ph))
   WHERE NOT EXISTS (SELECT 1 FROM propyte_crm.recruit_candidates r2 WHERE r2."contactId" = c.id)
   -- Si coincide con varios, primero el que ya es Empleo, luego el más antiguo.
   ORDER BY cand.id, (c."contactType" = 'EMPLEO') DESC NULLS LAST, c."createdAt"
)
-- Un contacto, una ficha: si dos candidatos caen en el mismo contacto, se liga el más antiguo y el
-- otro recibe su propio contacto en el paso 1b.
SELECT DISTINCT ON (contact_id) cand_id, contact_id FROM par ORDER BY contact_id, "createdAt", cand_id;

UPDATE propyte_crm.recruit_candidates r
   SET "contactId" = l.contact_id, "updatedAt" = CURRENT_TIMESTAMP
  FROM _ligados l
 WHERE r.id = l.cand_id;

UPDATE propyte_crm.contacts c
   SET "contactType" = 'EMPLEO', "updatedAt" = CURRENT_TIMESTAMP
  FROM _ligados l
 WHERE c.id = l.contact_id AND c."contactType" IS NULL;

-- ---------------------------------------------------------------------------------------------
-- 1b. Candidatos que siguen sin contacto → contacto nuevo tipo Empleo, «Derivado a RH».
-- ---------------------------------------------------------------------------------------------
CREATE TEMP TABLE _nuevos ON COMMIT DROP AS
SELECT r.id AS cand_id,
       gen_random_uuid()::text AS contact_id,
       -- Nombre: con 4 palabras o más, las dos primeras son el nombre (Jesús Rafael | Torres Lizama).
       CASE WHEN cardinality(p.w) >= 4 THEN p.w[1] || ' ' || p.w[2] ELSE coalesce(p.w[1], 'Sin nombre') END AS first_name,
       array_to_string(p.w[(CASE WHEN cardinality(p.w) >= 4 THEN 3 ELSE 2 END):cardinality(p.w)], ' ') AS last_name,
       NULLIF(btrim(r.email), '') AS email,
       -- Teléfono en E.164, igual que normalizePhoneE164 (src/lib/phone.ts): 10 dígitos → +52.
       CASE
         WHEN length(t.d) < 10 OR length(t.d) > 15 THEN coalesce(btrim(r.phone), '')
         WHEN t.d ~ '^521' AND length(t.d) = 13 THEN '+52' || substr(t.d, 4)
         WHEN t.mas THEN '+' || t.d
         WHEN length(t.d) = 10 THEN '+52' || t.d
         ELSE '+' || t.d
       END AS phone,
       NULLIF(btrim(r.area), '') AS area,
       CASE WHEN r.plaza IN ('PDC', 'TULUM', 'MERIDA') THEN r.plaza::propyte_crm."Plaza" END AS plaza,
       'Reclutamiento (' || CASE r.source WHEN 'NOTION' THEN 'Notion' WHEN 'MANUAL' THEN 'alta manual'
                                          WHEN 'CHAT' THEN 'chat' ELSE lower(r.source) END || ')' AS detalle,
       r."createdAt"
  FROM propyte_crm.recruit_candidates r
  CROSS JOIN LATERAL (
    SELECT regexp_split_to_array(btrim(regexp_replace(r."fullName", '\s+', ' ', 'g')), ' ') AS w
  ) p
  CROSS JOIN LATERAL (
    SELECT regexp_replace(coalesce(r.phone, ''), '\D', '', 'g') AS d,
           btrim(coalesce(r.phone, '')) LIKE '+%' AS mas
  ) t
 WHERE r."contactId" IS NULL AND r."deletedAt" IS NULL;

INSERT INTO propyte_crm.contacts (
  id, "firstName", "lastName", email, phone, "contactType", "leadSource", "leadSourceDetail",
  "appliedPosition", "targetPlaza", estado, tags, "createdAt", "updatedAt"
)
SELECT n.contact_id, n.first_name, n.last_name, n.email, n.phone, 'EMPLEO', 'OTRO', n.detalle,
       n.area, n.plaza, 'DERIVADO_A_RH', ARRAY['reclutamiento-2026-11'], n."createdAt", CURRENT_TIMESTAMP
  FROM _nuevos n;

UPDATE propyte_crm.recruit_candidates r
   SET "contactId" = n.contact_id, "updatedAt" = CURRENT_TIMESTAMP
  FROM _nuevos n
 WHERE r.id = n.cand_id;

-- ---------------------------------------------------------------------------------------------
-- 2. Contactos Empleo sin ficha → ficha en «1 · Recibido».
-- ---------------------------------------------------------------------------------------------
INSERT INTO propyte_crm.recruit_candidates (
  id, "fullName", email, phone, area, plaza, stage, source, "contactId", "createdAt", "updatedAt", "stageChangedAt"
)
SELECT gen_random_uuid()::text,
       left(coalesce(NULLIF(btrim(concat_ws(' ', c."firstName", c."lastName")), ''), 'Sin nombre'), 200),
       NULLIF(btrim(c.email), ''),
       NULLIF(btrim(c.phone), ''),
       NULLIF(btrim(c."appliedPosition"), ''),
       c."targetPlaza"::text,
       'RECIBIDO',
       'CONTACTO',
       c.id,
       coalesce(c."originalCreatedAt", c."createdAt"),
       CURRENT_TIMESTAMP,
       coalesce(c."originalCreatedAt", c."createdAt")
  FROM propyte_crm.contacts c
 WHERE c."contactType" = 'EMPLEO' AND c."deletedAt" IS NULL AND c."mergedIntoId" IS NULL
ON CONFLICT ("contactId") DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- 3. Disparador: de aquí en adelante, los dos módulos se mantienen ligados.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION propyte_crm.reclutamiento_de_contacto()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."contactType" IS DISTINCT FROM OLD."contactType" THEN
    IF NEW."contactType" = 'EMPLEO' AND NEW."deletedAt" IS NULL AND NEW."mergedIntoId" IS NULL THEN
      -- Entró a Empleo: ficha en Recibido. Si ya tiene una (aunque RH la haya borrado), nada.
      INSERT INTO propyte_crm.recruit_candidates (
        id, "fullName", email, phone, area, plaza, stage, source, "contactId",
        "createdAt", "updatedAt", "stageChangedAt"
      ) VALUES (
        gen_random_uuid()::text,
        left(coalesce(NULLIF(btrim(concat_ws(' ', NEW."firstName", NEW."lastName")), ''), 'Sin nombre'), 200),
        NULLIF(btrim(NEW.email), ''),
        NULLIF(btrim(NEW.phone), ''),
        NULLIF(btrim(NEW."appliedPosition"), ''),
        NEW."targetPlaza"::text,
        'RECIBIDO',
        'CONTACTO',
        NEW.id,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("contactId") DO NOTHING;
      -- Ya tenía ficha y la había descartado este mismo disparador: regresa a su etapa.
      UPDATE propyte_crm.recruit_candidates
         SET stage = "stagePrevia",
             "stagePrevia" = NULL,
             "stageChangedAt" = CURRENT_TIMESTAMP,
             "updatedAt" = CURRENT_TIMESTAMP,
             notes = concat_ws(E'\n', NULLIF(notes, ''),
               to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Cancun', 'DD/MM/YYYY')
               || ' · Reabierto automáticamente: en Contactos volvió a ser Empleo.')
       WHERE "contactId" = NEW.id
         AND "deletedAt" IS NULL
         AND stage = 'DESCARTADO'
         AND "stagePrevia" IS NOT NULL;
    ELSIF TG_OP = 'UPDATE' AND OLD."contactType" = 'EMPLEO' THEN
      -- Dejó de ser Empleo: la ficha pasa a Descartado con nota (decisión del 03-nov).
      UPDATE propyte_crm.recruit_candidates
         SET "stagePrevia" = stage,
             stage = 'DESCARTADO',
             "stageChangedAt" = CURRENT_TIMESTAMP,
             "updatedAt" = CURRENT_TIMESTAMP,
             notes = concat_ws(E'\n', NULLIF(notes, ''),
               to_char(CURRENT_TIMESTAMP AT TIME ZONE 'America/Cancun', 'DD/MM/YYYY')
               || ' · Descartado automáticamente: en Contactos dejó de ser Empleo (ahora '
               || coalesce(initcap(replace(NEW."contactType"::text, '_', ' ')), 'sin tipo') || ').')
       WHERE "contactId" = NEW.id
         AND "deletedAt" IS NULL
         AND stage NOT IN ('DESCARTADO', 'CONTRATADO');
    END IF;
  END IF;

  -- Fusión de contactos: la ficha sigue al que sobrevive, si ese no tiene ya una.
  IF TG_OP = 'UPDATE' AND NEW."mergedIntoId" IS NOT NULL
     AND NEW."mergedIntoId" IS DISTINCT FROM OLD."mergedIntoId" THEN
    UPDATE propyte_crm.recruit_candidates
       SET "contactId" = NEW."mergedIntoId", "updatedAt" = CURRENT_TIMESTAMP
     WHERE "contactId" = NEW.id
       AND NOT EXISTS (
         SELECT 1 FROM propyte_crm.recruit_candidates r2 WHERE r2."contactId" = NEW."mergedIntoId"
       );
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_contacts_reclutamiento
  AFTER INSERT OR UPDATE OF "contactType", "mergedIntoId" ON propyte_crm.contacts
  FOR EACH ROW EXECUTE FUNCTION propyte_crm.reclutamiento_de_contacto();

COMMIT;
