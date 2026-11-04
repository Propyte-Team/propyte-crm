-- #958 — Vista previa de 2026-11-04-estados-migracion-958.sql. SOLO LECTURA: no cambia nada.
-- Misma clasificación que la migración. Primera consulta: el resumen. Segunda: una muestra de 20
-- (proporcional a cada regla, al azar pero repetible) para revisarla a mano antes de correr la migración.

-- 1) Resumen
WITH m AS (
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
FROM ev
)
SELECT regla,
       CASE regla
         WHEN 'perdido' THEN 'Negocio Perdido · sin razón (tarea) · previa Demo'
         WHEN 'pospuso' THEN 'Negocio Perdido · Pospuso la compra (tarea: fecha) · previa Demo'
         WHEN 'broker' THEN 'Registrado por broker'
         WHEN 'dejo_de_responder' THEN 'Negocio Perdido · Dejó de responder · previa Demo'
         WHEN 'demo' THEN 'Demo · Realizada'
         ELSE 'Contactado · En conversación'
       END AS destino,
       count(*) AS contactos,
       count(*) FILTER (WHERE broker_reg) AS de_registro_broker,
       count(*) FILTER (WHERE broker_reg AND broker_final IS NULL) AS confirmar_broker,
       count(*) FILTER (WHERE broker_crm IS NOT NULL AND "referredById" IS NULL) AS se_liga_broker
  FROM m GROUP BY regla ORDER BY contactos DESC;

-- 2) Muestra de 20
WITH m AS (
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
FROM ev
), r AS (
  SELECT m.*, row_number() OVER (PARTITION BY regla ORDER BY md5(id)) AS k, count(*) OVER (PARTITION BY regla) AS total
    FROM m
)
SELECT c."firstName" || ' ' || coalesce(c."lastName", '') AS contacto,
       'https://crm.propyte.com/contacts/' || c.id AS ficha,
       c."leadSource"::text AS fuente, r.cs AS estado_viejo, r.regla,
       r.reunion, r.negocio, r.nota_demo, r.congelado, to_char(r.ultima, 'YYYY-MM-DD') AS ultima_actividad,
       coalesce(b."firstName" || ' ' || coalesce(b."lastName", ''), r.broker_zoho_nombre) AS broker
  FROM r
  JOIN propyte_crm.contacts c ON c.id = r.id
  LEFT JOIN propyte_crm.contacts b ON b.id = r.broker_final
 WHERE r.k <= greatest(1, floor(20.0 * r.total / (SELECT count(*) FROM m)))
 ORDER BY r.regla, r.k
 LIMIT 20;
