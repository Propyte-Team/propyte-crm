-- #954 y #955 — Agentes del bot para los tipos del #938.
--
--   #954: «Agente Clientes» pasa a llamarse «Agente Lead Comprador» y su playbook pasa a
--         «Lead Comprador — calificación de inversión». Su guion menciona a los referidos y
--         aclara que no atiende a quien viene a vender. Atiende los tipos que le dejó la Parte B
--         de la #938: Lead Comprador, Prospecto, Referido de Broker y Referido de Cliente.
--         Clientes (los que ya compraron) siguen con «Agente Clientes Actuales».
--   #955: agente nuevo «Agente Lead Vendedor» (tipo LEAD_VENDEDOR), con playbook
--         «Lead Vendedor — captación de propiedad». Prioridad 15, ACTIVO desde que se aplica.
--
-- Solo DATOS. No depende del orden del despliegue:
--   · Renombrar no rompe el código de producción: el bot elige agente por TIPO, no por nombre.
--   · LEAD_VENDEDOR ya existe en el enum (Parte A de la #938, aplicada el 30-oct).
-- Lo único que busca por nombre es scripts/seed-bot-playbooks-segmento.ts; con este PR ya busca
-- los nombres nuevos.
--
-- Las tareas del playbook nuevo son copia de src/lib/bot/playbook/segment-playbooks.ts
-- (generadas desde ahí). Si cambian allá, se re-aplican con
--   npx tsx scripts/seed-bot-playbooks-segmento.ts
-- que reemplaza las tareas conservando el id del playbook.
--
-- Idempotente: re-ejecutarlo no duplica nada. Va en UNA transacción.
-- Aplicar en el SQL Editor de Supabase (oaijxdpevakashxshhvm).

BEGIN;

-- ── #954: renombre del agente de compradores ──
UPDATE "propyte_crm"."bot_agent_profiles"
   SET "name" = 'Agente Lead Comprador',
       "identity" = 'Hablas con alguien interesado en comprar, rentar o invertir en una propiedad: es un lead comercial (comprador, inversionista o lead nuevo), no un aliado, ni un candidato a empleo, ni alguien que viene a vender. Puede llegar referido por un broker o por un cliente: si lo menciona, agradécelo, pero califícalo igual que a cualquier lead. Tu situación: calificarlo con naturalidad (zona, presupuesto, tipo de propiedad, plazo, si es para vivir o invertir) y, cuando tengas catálogo real en contexto, mostrarle 1-2 opciones que encajen. Nunca le ofrezcas esquemas de comisión ni le hables como si fuera broker o candidato a empleo.',
       "updatedAt" = now()
 WHERE "id" = 'c51cdb46-1cb8-41d0-9b89-2b8066e4f155'
   AND "name" IN ('Agente Clientes', 'Agente Lead Comprador');

UPDATE "propyte_crm"."bot_playbooks"
   SET "name" = 'Lead Comprador — calificación de inversión',
       "description" = 'Lead Comprador (compradores, inversionistas y leads) y referidos: zona, presupuesto, tipo de propiedad, plazo y perfil de inversión. Es el playbook global más el perfil de inversión, que es lo que separa a un usuario final de un inversionista.',
       "updatedAt" = now()
 WHERE "id" = '03e424c5-c978-4152-a7e3-f86a9202c8e4'
   AND "name" IN ('Clientes — calificación de inversión', 'Lead Comprador — calificación de inversión');

-- ── #955: playbook y agente para Lead Vendedor ──
INSERT INTO "propyte_crm"."bot_playbooks" ("id", "name", "description", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Lead Vendedor — captación de propiedad', 'Dueños que quieren vender: qué propiedad es, dónde está, precio que espera, situación legal y en cuánto tiempo quiere vender. Nada de presupuesto de compra: el vendedor no viene a comprar.', true, now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM "propyte_crm"."bot_playbooks"
                    WHERE "name" = 'Lead Vendedor — captación de propiedad' AND "deletedAt" IS NULL);

INSERT INTO "propyte_crm"."bot_tasks"
  ("id", "playbookId", "order", "key", "objective", "targetField", "captureType", "enumOptions", "extractionHint", "required", "skipIfFilled", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."id", t.ord, t.key, t.objective, t.target, t.capture::"propyte_crm"."CaptureType", t.opciones::jsonb, t.hint, t.req, true, true, now(), now()
  FROM "propyte_crm"."bot_playbooks" p
 CROSS JOIN (VALUES
    (0, 'nombre', 'Pregunta su nombre para poder dirigirte a él o ella de forma personal.', 'firstName', 'FULL_NAME', '[]', NULL, true),
    (1, 'tipo_propiedad', 'Pregunta qué tipo de propiedad quiere vender.', 'custom.propiedad_venta_tipo', 'ENUM', '[{"value":"DEPARTAMENTO","synonyms":["depa","departamento","depto","condo"]},{"value":"CASA","synonyms":["casa","residencia","villa"]},{"value":"TERRENO","synonyms":["terreno","lote"]},{"value":"MACROLOTE","synonyms":["macrolote"]},{"value":"LOCAL_COMERCIAL","synonyms":["local","comercial","oficina"]},{"value":"OTRO","synonyms":["otro"]}]', NULL, true),
    (2, 'ubicacion', 'Pregunta dónde está la propiedad: ciudad, zona y, si aplica, el nombre del desarrollo.', 'custom.propiedad_venta_ubicacion', 'TEXT', '[]', 'Guarda la ubicación como la diga, en una línea (p. ej. "Tulum, Aldea Zamá").', true),
    (3, 'precio', 'Pregunta en cuánto le gustaría venderla. Si todavía no lo sabe, está bien: no insistas, el asesor le ayuda a definirlo.', 'custom.propiedad_venta_precio', 'MONEY', '[]', NULL, true),
    (4, 'moneda', 'Si dio un precio y no queda claro, confirma si es en pesos o en dólares.', 'custom.propiedad_venta_moneda', 'ENUM', '[{"value":"MXN","synonyms":["pesos","mxn","moneda nacional"]},{"value":"USD","synonyms":["dólares","dolares","usd","dls"]}]', NULL, false),
    (5, 'situacion_legal', 'Pregunta si la propiedad ya está escriturada a su nombre o si la compró en preventa (cesión de derechos). Pregúntalo natural, no como trámite.', 'custom.propiedad_venta_situacion_legal', 'ENUM', '[{"value":"ESCRITURADA","synonyms":["escriturada","tengo escrituras","ya está escriturada","a mi nombre"]},{"value":"CESION_DE_DERECHOS","synonyms":["preventa","cesión de derechos","todavía no me la entregan","contrato de compraventa"]},{"value":"EN_TRAMITE","synonyms":["en trámite","escriturando","en proceso"]},{"value":"OTRO","synonyms":["no sé","otro","herencia","intestado"]}]', NULL, true),
    (6, 'plazo_venta', 'Pregunta en cuánto tiempo le gustaría venderla.', 'custom.propiedad_venta_plazo', 'ENUM', '[{"value":"INMEDIATO","synonyms":["ya","lo antes posible","urgente","este mes"]},{"value":"UNO_A_TRES_MESES","synonyms":["1 a 3 meses","pronto","unos meses"]},{"value":"TRES_A_SEIS_MESES","synonyms":["3 a 6 meses","medio año"]},{"value":"SIN_PRISA","synonyms":["sin prisa","no tengo prisa","solo explorando","cuando se pueda"]}]', NULL, true),
    (7, 'telefono', 'Pide un teléfono para que el asesor de captación lo contacte.', 'phone', 'PHONE', '[]', NULL, true)
  ) AS t(ord, key, objective, target, capture, opciones, hint, req)
 WHERE p."name" = 'Lead Vendedor — captación de propiedad' AND p."deletedAt" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "propyte_crm"."bot_tasks" x WHERE x."playbookId" = p."id");

INSERT INTO "propyte_crm"."bot_agent_profiles"
  ("id", "name", "contactTypes", "identity", "playbookId", "tonePreset", "isActive", "priority", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Agente Lead Vendedor', ARRAY['LEAD_VENDEDOR']::"propyte_crm"."ContactType"[],
       'Hablas con el dueño de una propiedad que quiere venderla: no es un comprador, ni un broker de otra inmobiliaria, ni un candidato a empleo. Tu situación: es una posible captación para Propyte. Tu objetivo es entender con naturalidad qué propiedad es (tipo y ubicación), en cuánto le gustaría venderla, si está escriturada o la compró en preventa, y en cuánto tiempo quiere vender, para que un asesor de captación lo contacte. Nunca le preguntes su presupuesto de compra ni le ofrezcas propiedades del catálogo como si fuera a comprar. No le des un avalúo, no le prometas un precio ni un tiempo de venta, y no negocies comisiones: eso lo platica el asesor.',
       p."id", NULL, true, 15, now(), now()
  FROM "propyte_crm"."bot_playbooks" p
 WHERE p."name" = 'Lead Vendedor — captación de propiedad' AND p."deletedAt" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "propyte_crm"."bot_agent_profiles"
                    WHERE "name" = 'Agente Lead Vendedor' AND "deletedAt" IS NULL);

COMMIT;

-- Comprobación:
--   SELECT a."name", a."isActive", a."priority", a."contactTypes", p."name" AS playbook,
--          (SELECT count(*) FROM "propyte_crm"."bot_tasks" t WHERE t."playbookId" = p."id") AS tareas
--     FROM "propyte_crm"."bot_agent_profiles" a
--     LEFT JOIN "propyte_crm"."bot_playbooks" p ON p."id" = a."playbookId"
--    WHERE a."deletedAt" IS NULL ORDER BY a."priority";
-- Debe salir «Agente Lead Comprador» (6 tareas) y «Agente Lead Vendedor» (8 tareas, activo, [LEAD_VENDEDOR]).
--
-- Rollback:
--   · #954: renombrar de vuelta. El guion anterior está en la tarjeta #954 del HUB.
--   · #955: UPDATE "propyte_crm"."bot_agent_profiles" SET "isActive" = false WHERE "name" = 'Agente Lead Vendedor';
--     Apagado, a un Lead Vendedor le vuelve a contestar el bot general.
