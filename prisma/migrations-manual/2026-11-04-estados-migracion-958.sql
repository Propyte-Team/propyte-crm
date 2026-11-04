-- #958 (entrega 3 de #953) — Mover los datos actuales al estado nuevo.
--
-- SOLO DATOS: no cambia tablas ni columnas. Reglas de Luis (3.ª ronda, preguntas 15–17; 4.ª ronda,
-- pregunta 3) y decisiones de sistemas@ (04-nov):
--
--   A. «Por clasificar» (estado vacío; en Zoho todos eran «Demo o Visita»), en este orden:
--      1. Zoho «Prospecto Perdido» (contactStatus PERDIDO) → Negocio Perdido, etapa previa Demo, SIN
--         razón (no hay motivo genérico): etiqueta falta-razon y tarea para su asesor.
--      2. Negocio congelado (FROZEN) → Negocio Perdido · Pospuso la compra, etapa previa Demo, sin fecha
--         de recontacto: etiqueta falta-fecha-recontacto y tarea para su asesor.
--      3. Registrado por un broker que el CRM ya tiene (referredById, o el «Broker asociado» de Zoho
--         que coincide con un broker del CRM, y entonces se liga) → Registrado por broker.
--      4. Con pruebas de demo (reunión registrada, negocio o nota de demo/visita/recorrido/showroom/videollamada/
--         presentación) y más de 90 días sin actividad → Negocio Perdido · Dejó de responder, etapa
--         previa Demo.
--      5. Con pruebas de demo → Demo · Realizada.
--      6. Sin pruebas → Contactado · En conversación (la cadencia post-contacto de Copilot decide).
--      Si vino de «Registro de broker» y no se pudo ligar el broker: etiqueta confirmar-broker y
--      tarea al gerente («Buscar y ligar», sistemas@ 04-nov). En los pasos 1, 2, 4 y 5 también se
--      liga el broker cuando el «Broker asociado» de Zoho coincide con uno del CRM.
--   B. Contactado perdido sin razón → etiqueta falta-razon (va en la misma tarea del asesor).
--   C. Flujo F8 (Empleo) que no está en «Derivado a RH» → Derivado a RH (su ficha de Reclutamiento,
--      #959, no se toca).
--   D. Tareas: UNA por persona (sistemas@ 04-nov), con el enlace a la lista filtrada por etiqueta.
--      La del asesor sale con fecha a 7 días (regla de Luis). Si el dueño está inactivo, la tarea va
--      al gerente de su plaza (o a un director).
--   E. Las etiquetas falta-razon, falta-fecha-recontacto y confirmar-broker se quitan solas
--      (disparador trg_contacts_zz_etiquetas_958) cuando se elige la razón, la fecha o se liga el broker.
--      Todo lo que toca queda con la etiqueta migracion-958.
--
-- Los negocios (deals) NO se tocan: los de antes del apartado siguen en la ficha como «Negocios
-- anteriores». La lista de intereses va en su propia tarjeta (sistemas@ 04-nov).
--
-- La cronología lo marca como «Migración de estados (#958)» (crm.source = estado_migracion_958).
-- Respaldo: propyte_crm._respaldo_958_contacts (las columnas que se cambian, tal como estaban).
--
-- Aplicar en Supabase → SQL Editor (oaijxdpevakashxshhvm). No depende del código: el código de la
-- rama solo agrega el filtro ?etiqueta= de la lista, que hace funcionar los enlaces de las tareas.
-- Idempotente: la segunda corrida no encuentra nada que mover ni crea tareas repetidas.
-- Va en UNA transacción.
--
-- Vista previa (antes de correrla): 2026-11-04-estados-migracion-958-vista-previa.sql.
--
-- Comprobación:
--   SELECT coalesce(estado::text,'POR_CLASIFICAR') estado, subestado, "razonSalida", "etapaPrevia", count(*)
--   FROM propyte_crm.contacts WHERE 'migracion-958' = ANY(tags) GROUP BY 1,2,3,4 ORDER BY 5 DESC;
--   SELECT count(*) FROM propyte_crm.contacts WHERE "deletedAt" IS NULL AND estado IS NULL;  -- 0
--   SELECT u.name, a.subject FROM propyte_crm.activities a JOIN propyte_crm.users u ON u.id = a."userId"
--   WHERE a.subject LIKE '%(#958)%';
--
-- Rollback de los datos (con el respaldo):
--   UPDATE propyte_crm.contacts c SET estado = r.estado, subestado = r.subestado, "razonSalida" = r."razonSalida",
--     "etapaPrevia" = r."etapaPrevia", "referredById" = r."referredById", tags = r.tags, "contactStatus" = r."contactStatus"
--   FROM propyte_crm._respaldo_958_contacts r WHERE r.id = c.id;
--   UPDATE propyte_crm.activities SET "deletedAt" = now() WHERE subject LIKE '%(#958)%';

BEGIN;

SELECT set_config('crm.source', 'estado_migracion_958', true), set_config('crm.actor_id', '', true);

-- ───────────────────────────── 0. clasificación ─────────────────────────────
-- Misma lógica que la vista previa. Solo contactos vivos y no fusionados.
CREATE TEMP TABLE m958 ON COMMIT DROP AS
WITH pc AS (
  SELECT c.id, c."contactStatus"::text AS cs, (c."leadSource" = 'REGISTRO_BROKER') AS broker_reg,
         c."referredById", c."assignedToId", c."lastActivityAt",
         c.custom -> 'zoho' -> 'extra' -> 'Broker_Asociado' ->> 'id'   AS broker_zoho_id,
         c.custom -> 'zoho' -> 'extra' -> 'Broker_Asociado' ->> 'name' AS broker_zoho_nombre
    FROM propyte_crm.contacts c
   WHERE c."deletedAt" IS NULL AND c."mergedIntoId" IS NULL AND c.estado IS NULL
), ev AS (
  SELECT pc.*,
    (SELECT b.id FROM propyte_crm.contacts b
      WHERE pc.broker_zoho_id IS NOT NULL AND b."deletedAt" IS NULL AND b."mergedIntoId" IS NULL
        AND b."contactType" = 'BROKER_EXTERNO' AND b.id <> pc.id
        AND (b."zohoId" = pc.broker_zoho_id OR b.custom -> 'zoho' ->> 'id' = pc.broker_zoho_id)
      ORDER BY b."createdAt" LIMIT 1) AS broker_crm,
    EXISTS (SELECT 1 FROM propyte_crm.activities a WHERE a."contactId" = pc.id AND a."deletedAt" IS NULL
             AND a."activityType"::text LIKE 'MEETING%') AS reunion,
    EXISTS (SELECT 1 FROM propyte_crm.deals d WHERE d."contactId" = pc.id AND d."deletedAt" IS NULL) AS negocio,
    EXISTS (SELECT 1 FROM propyte_crm.deals d WHERE d."contactId" = pc.id AND d."deletedAt" IS NULL
             AND d.stage = 'FROZEN' AND d.etapa IS NULL) AS congelado,
    EXISTS (SELECT 1 FROM propyte_crm.activities a WHERE a."contactId" = pc.id AND a."deletedAt" IS NULL
             AND (coalesce(a.subject, '') || ' ' || coalesce(a.description, '')) ~* '(demo|visit|recorrid|showroom|presentaci|present[oó] |videollamada)') AS nota_demo,
    greatest(pc."lastActivityAt",
      (SELECT max(greatest(a."createdAt", coalesce(a."completedAt", a."createdAt")))
         FROM propyte_crm.activities a WHERE a."contactId" = pc.id AND a."deletedAt" IS NULL)) AS ultima
  FROM pc
)
SELECT ev.*,
  (reunion OR negocio OR nota_demo) AS demo_ev,
  (ultima IS NULL OR ultima < now() - interval '90 days') AS inactivo90,
  coalesce("referredById", broker_crm) AS broker_final,
  CASE
    WHEN cs = 'PERDIDO' THEN 'perdido'
    WHEN congelado THEN 'pospuso'
    WHEN broker_reg AND coalesce("referredById", broker_crm) IS NOT NULL THEN 'broker'
    WHEN (reunion OR negocio OR nota_demo) AND (ultima IS NULL OR ultima < now() - interval '90 days') THEN 'dejo_de_responder'
    WHEN (reunion OR negocio OR nota_demo) THEN 'demo'
    ELSE 'contactado'
  END AS regla
FROM ev;

-- ───────────────────────────── 1. respaldo ─────────────────────────────
CREATE TABLE IF NOT EXISTS propyte_crm._respaldo_958_contacts AS
  SELECT id, estado, subestado, "razonSalida", "etapaPrevia", "referredById", tags, "contactStatus", now() AS respaldado_en
    FROM propyte_crm.contacts WITH NO DATA;
ALTER TABLE propyte_crm._respaldo_958_contacts ENABLE ROW LEVEL SECURITY; -- sin políticas: solo el servicio

INSERT INTO propyte_crm._respaldo_958_contacts (id, estado, subestado, "razonSalida", "etapaPrevia", "referredById", tags, "contactStatus", respaldado_en)
SELECT c.id, c.estado, c.subestado, c."razonSalida", c."etapaPrevia", c."referredById", c.tags, c."contactStatus", now()
  FROM propyte_crm.contacts c
 WHERE c."deletedAt" IS NULL AND c."mergedIntoId" IS NULL
   AND (c.id IN (SELECT id FROM m958)
        OR (c.estado = 'CONTACTADO_PERDIDO' AND c."razonSalida" IS NULL)
        OR (c.flujo = 'F8_EMPLEO' AND c.estado IS DISTINCT FROM 'DERIVADO_A_RH'))
   AND NOT EXISTS (SELECT 1 FROM propyte_crm._respaldo_958_contacts r WHERE r.id = c.id);

-- ───────────────────────────── 2. etiquetas del catálogo ─────────────────────────────
INSERT INTO propyte_crm.contact_tags (id, name, "nameKey", "createdAt")
SELECT gen_random_uuid()::text, t, t, now()
  FROM unnest(ARRAY['migracion-958', 'falta-razon', 'falta-fecha-recontacto', 'confirmar-broker']) t
 WHERE NOT EXISTS (SELECT 1 FROM propyte_crm.contact_tags x WHERE x."nameKey" = t);

-- ───────────────────────────── 3. «Por clasificar» ─────────────────────────────
-- Un solo UPDATE por contacto: estado, subestado, razón, broker y etiquetas. La etapa previa va en
-- el paso 4 (al entrar a una salida, el disparador del #953 la toma del estado anterior, que aquí
-- es vacío).
UPDATE propyte_crm.contacts c
   SET estado = (CASE m.regla
                   WHEN 'perdido' THEN 'NEGOCIO_PERDIDO'
                   WHEN 'pospuso' THEN 'NEGOCIO_PERDIDO'
                   WHEN 'broker' THEN 'REGISTRADO_POR_BROKER'
                   WHEN 'dejo_de_responder' THEN 'NEGOCIO_PERDIDO'
                   WHEN 'demo' THEN 'DEMO'
                   ELSE 'CONTACTADO'
                 END)::propyte_crm."EstadoContacto",
       subestado = CASE m.regla WHEN 'demo' THEN 'REALIZADA' WHEN 'contactado' THEN 'EN_CONVERSACION' ELSE NULL END,
       "razonSalida" = (CASE m.regla WHEN 'pospuso' THEN 'POSPUSO' WHEN 'dejo_de_responder' THEN 'DEJO_DE_RESPONDER' ELSE NULL END)::propyte_crm."RazonSalida",
       "referredById" = coalesce(c."referredById", m.broker_crm),
       tags = (SELECT array_agg(DISTINCT t ORDER BY t) FROM unnest(
                 coalesce(c.tags, '{}') || ARRAY['migracion-958']
                 || CASE WHEN m.regla = 'perdido' THEN ARRAY['falta-razon'] ELSE '{}'::text[] END
                 || CASE WHEN m.regla = 'pospuso' THEN ARRAY['falta-fecha-recontacto'] ELSE '{}'::text[] END
                 || CASE WHEN m.broker_reg AND m.broker_final IS NULL THEN ARRAY['confirmar-broker'] ELSE '{}'::text[] END
               ) t)
  FROM m958 m
 WHERE c.id = m.id AND c.estado IS NULL;

-- ───────────────────────────── 4. etapa previa Demo de las salidas ─────────────────────────────
UPDATE propyte_crm.contacts c
   SET "etapaPrevia" = 'DEMO'
  FROM m958 m
 WHERE c.id = m.id AND m.regla IN ('perdido', 'pospuso', 'dejo_de_responder')
   AND c.estado = 'NEGOCIO_PERDIDO' AND c."etapaPrevia" IS NULL;

-- ───────────────────────────── 5. Contactado perdido sin razón ─────────────────────────────
UPDATE propyte_crm.contacts c
   SET tags = (SELECT array_agg(DISTINCT t ORDER BY t) FROM unnest(coalesce(c.tags, '{}') || ARRAY['migracion-958', 'falta-razon']) t)
 WHERE c."deletedAt" IS NULL AND c."mergedIntoId" IS NULL
   AND c.estado = 'CONTACTADO_PERDIDO' AND c."razonSalida" IS NULL
   AND c.flujo IS DISTINCT FROM 'F8_EMPLEO'
   AND NOT ('falta-razon' = ANY (coalesce(c.tags, '{}')));

-- ───────────────────────────── 6. Empleo → Derivado a RH ─────────────────────────────
UPDATE propyte_crm.contacts c
   SET estado = 'DERIVADO_A_RH',
       tags = (SELECT array_agg(DISTINCT t ORDER BY t) FROM unnest(coalesce(c.tags, '{}') || ARRAY['migracion-958']) t)
 WHERE c."deletedAt" IS NULL AND c."mergedIntoId" IS NULL
   AND c.flujo = 'F8_EMPLEO' AND c.estado IS DISTINCT FROM 'DERIVADO_A_RH';

-- ───────────────────────────── 7. etiquetas que se quitan solas ─────────────────────────────
CREATE OR REPLACE FUNCTION propyte_crm.etiquetas_958()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tags IS NULL OR cardinality(NEW.tags) = 0 THEN
    RETURN NEW;
  END IF;
  IF 'falta-razon' = ANY (NEW.tags)
     AND (NEW."razonSalida" IS NOT NULL OR NEW.estado IS NULL
          OR NEW.estado NOT IN ('PERDIDO', 'CONTACTADO_PERDIDO', 'NEGOCIO_PERDIDO')) THEN
    NEW.tags := array_remove(NEW.tags, 'falta-razon');
  END IF;
  IF 'falta-fecha-recontacto' = ANY (NEW.tags)
     AND (NEW."fechaRecontacto" IS NOT NULL OR NEW."razonSalida" IS DISTINCT FROM 'POSPUSO') THEN
    NEW.tags := array_remove(NEW.tags, 'falta-fecha-recontacto');
  END IF;
  IF 'confirmar-broker' = ANY (NEW.tags) AND NEW."referredById" IS NOT NULL THEN
    NEW.tags := array_remove(NEW.tags, 'confirmar-broker');
  END IF;
  RETURN NEW;
END;
$$;

-- «zz»: corre después de trg_contacts_estado (los BEFORE van en orden alfabético), así ve la razón ya
-- limpiada por una reactivación.
DROP TRIGGER IF EXISTS trg_contacts_zz_etiquetas_958 ON propyte_crm.contacts;
CREATE TRIGGER trg_contacts_zz_etiquetas_958
  BEFORE UPDATE OF tags, estado, "razonSalida", "fechaRecontacto", "referredById" ON propyte_crm.contacts
  FOR EACH ROW
  EXECUTE FUNCTION propyte_crm.etiquetas_958();

-- ───────────────────────────── 8. tareas, una por persona ─────────────────────────────
-- A quién: el dueño si está activo; si no, el gerente de su plaza; si no, un director; si no, un
-- administrador. Las cuentas técnicas (@propyte.local) nunca reciben tareas.
CREATE TEMP TABLE t958 ON COMMIT DROP AS
WITH etiquetados AS (
  SELECT c.id, c."assignedToId", u.plaza,
         ('falta-razon' = ANY (c.tags)) AS razon,
         ('falta-fecha-recontacto' = ANY (c.tags)) AS fecha,
         ('confirmar-broker' = ANY (c.tags)) AS broker,
         (u.id IS NOT NULL AND u."isActive" AND u."deletedAt" IS NULL AND u.email NOT LIKE '%@propyte.local') AS dueno_activo
    FROM propyte_crm.contacts c
    LEFT JOIN propyte_crm.users u ON u.id = c."assignedToId"
   WHERE c."deletedAt" IS NULL AND 'migracion-958' = ANY (c.tags)
), jefe AS (
  SELECT e.*,
    (SELECT g.id FROM propyte_crm.users g
      WHERE g."isActive" AND g."deletedAt" IS NULL AND g.email NOT LIKE '%@propyte.local'
        AND g.role::text IN ('GERENTE', 'DIRECTOR', 'ADMIN')
      ORDER BY (g.role::text = 'GERENTE' AND g.plaza IS NOT DISTINCT FROM e.plaza) DESC,
               (g.role::text = 'GERENTE') DESC, (g.role::text = 'DIRECTOR') DESC, g."createdAt"
      LIMIT 1) AS jefe_id
  FROM etiquetados e
)
SELECT CASE WHEN dueno_activo THEN "assignedToId" ELSE jefe_id END AS para, 'asesor' AS tipo,
       count(*) FILTER (WHERE razon) AS n_razon, count(*) FILTER (WHERE fecha) AS n_fecha
  FROM jefe WHERE razon OR fecha
 GROUP BY 1
UNION ALL
SELECT (SELECT jefe_id FROM jefe WHERE broker ORDER BY jefe_id LIMIT 1), 'gerente', count(*), 0
  FROM jefe WHERE broker
HAVING count(*) > 0;

INSERT INTO propyte_crm.activities (id, "contactId", "userId", "activityType", subject, description, "dueDate", status, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, NULL, t.para, 'TASK',
       'Elegir razón y fecha de recontacto de contactos migrados (#958)',
       concat_ws(E'\n',
         CASE WHEN t.n_razon > 0 THEN t.n_razon || ' contactos quedaron en Negocio Perdido o Contactado perdido sin razón. Abre cada uno y elige la razón: https://crm.propyte.com/contacts?etiqueta=falta-razon' END,
         CASE WHEN t.n_fecha > 0 THEN t.n_fecha || ' contactos con un negocio congelado quedaron en Negocio Perdido · Pospuso la compra. Ponles la fecha de recontacto: https://crm.propyte.com/contacts?etiqueta=falta-fecha-recontacto' END,
         'La etiqueta se quita sola al guardar la razón o la fecha. Cuando las dos listas estén vacías, marca esta tarea como hecha.'),
       now() + interval '7 days', 'PENDIENTE', now(), now()
  FROM t958 t
 WHERE t.tipo = 'asesor' AND t.para IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM propyte_crm.activities a WHERE a."userId" = t.para AND a.subject = 'Elegir razón y fecha de recontacto de contactos migrados (#958)' AND a."deletedAt" IS NULL);

INSERT INTO propyte_crm.activities (id, "contactId", "userId", "activityType", subject, description, "dueDate", status, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, NULL, t.para, 'TASK',
       'Confirmar el broker de clientes registrados por broker (#958)',
       t.n_razon || ' clientes llegaron por «Registro de broker» pero el CRM no sabe qué broker los registró (en Zoho no quedó ligado). '
       || 'Sin broker ligado no tienen la protección de broker. Abre cada uno, liga su broker en la ficha o, si no tiene, quítale la etiqueta: '
       || 'https://crm.propyte.com/contacts?etiqueta=confirmar-broker' || E'\n'
       || 'La etiqueta se quita sola al ligar el broker.',
       now() + interval '7 days', 'PENDIENTE', now(), now()
  FROM t958 t
 WHERE t.tipo = 'gerente' AND t.para IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM propyte_crm.activities a WHERE a."userId" = t.para AND a.subject = 'Confirmar el broker de clientes registrados por broker (#958)' AND a."deletedAt" IS NULL);

COMMIT;
