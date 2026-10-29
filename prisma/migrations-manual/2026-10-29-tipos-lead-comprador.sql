-- #938 — Tipos de contacto: «Lead Comprador» (junta Lead, Comprador e Inversionista),
-- «Lead Vendedor», «Referido de Broker» y «Referido de Cliente».
--
-- Va en DOS partes, en este orden (lección del #907: desplegar antes de migrar rompió la lista
-- de contactos; y al revés, un Prisma Client viejo truena al LEER un valor de enum que no conoce):
--
--   PARTE A (esquema, aditiva) → ANTES de desplegar el código. Solo agrega 4 valores al enum.
--     Es compatible con el código que hoy está en producción: ninguna fila los usa todavía.
--   PARTE B (datos) → DESPUÉS de que el despliegue diga «Se ha completado». Pasa los contactos,
--     los perfiles del bot y la regla a los valores nuevos. Con el código viejo NO se puede correr:
--     ese código no conoce LEAD_COMPRADOR y fallaría al leer esas filas.
--
-- Los valores retirados (LEAD, COMPRADOR, INVERSIONISTA) se quedan en el enum: Postgres no deja
-- quitar un valor sin recrear el tipo. El código ya no los ofrece y traduce los que lleguen de
-- fuera a LEAD_COMPRADOR (CONTACT_TYPE_RETIRADOS en src/lib/constants.ts).
--
-- Aplicar vía execute_sql (o el SQL Editor) en oaijxdpevakashxshhvm, schema propyte_crm.

-- ═════════════════════════════ PARTE A — antes del despliegue ═════════════════════════════
-- Idempotente (IF NOT EXISTS). En Postgres 12+ puede ir dentro de una transacción; los valores
-- nuevos solo se pueden USAR después del COMMIT, por eso la Parte B va aparte.
ALTER TYPE "propyte_crm"."ContactType" ADD VALUE IF NOT EXISTS 'LEAD_COMPRADOR';
ALTER TYPE "propyte_crm"."ContactType" ADD VALUE IF NOT EXISTS 'LEAD_VENDEDOR';
ALTER TYPE "propyte_crm"."ContactType" ADD VALUE IF NOT EXISTS 'REFERIDO_DE_BROKER';
ALTER TYPE "propyte_crm"."ContactType" ADD VALUE IF NOT EXISTS 'REFERIDO_DE_CLIENTE';

-- Comprobación de la Parte A (deben salir los 4 al final):
--   SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--    JOIN pg_namespace n ON n.oid = t.typnamespace
--    WHERE n.nspname = 'propyte_crm' AND t.typname = 'ContactType' ORDER BY e.enumsortorder;
--
-- Rollback de la Parte A: no hace falta. Un valor de enum que nadie usa no cambia nada.


-- ═════════════════════════════ PARTE B — después del despliegue ═════════════════════════════
-- Medido el 2026-10-29 (vivos / total):
--   · contactos LEAD 57/58, COMPRADOR 17/166, INVERSIONISTA 0/2 → 74 vivos (226 en total).
--   · los 57 LEAD vivos no tienen clasificación del bot; los 17 COMPRADOR vivos los clasificó el bot.
--   · perfiles del bot con tipos retirados: «Agente Clientes» (activo) y su duplicado borrado.
--   · reglas: solo «WF3 — Anti-huérfano» (151cfb70, INACTIVA) filtra por tipo LEAD.
--   · ninguna otra tabla de configuración guarda estos tipos (barrido de todas las columnas
--     json/jsonb/text/arreglo de propyte_crm, 29-oct).
--
-- La cronología de cada contacto registra el cambio con la fuente «tipos_lead_comprador_938»
-- («Cambio de tipos (Lead Comprador)» en la ficha). Idempotente: re-ejecutarla no hace nada nuevo.
-- Va en UNA transacción: o entra todo o nada.

BEGIN;

SELECT set_config('crm.source', 'tipos_lead_comprador_938', true), set_config('crm.actor_id', '', true);

-- B1. Contactos → LEAD_COMPRADOR.
--     LEAD y COMPRADOR eran los tipos que ponía el intake por defecto, y el clasificador del bot
--     podía cambiarlos (OVERRIDABLE_TYPES). LEAD_COMPRADOR no es pisable: lo puede elegir un
--     asesor y el bot no debe pisarlo. Para que esos contactos sigan pudiendo clasificarse, a
--     los que no tienen clasificación del bot se les marca como «del bot»
--     (custom.bot_classification.type = LEAD_COMPRADOR), que es lo que hace el clasificador
--     cuando él pone un tipo. INVERSIONISTA nunca fue pisable, así que no se marca.
UPDATE "propyte_crm"."contacts" c
   SET "contactType" = 'LEAD_COMPRADOR',
       "custom" = CASE
         WHEN c."contactType" IN ('LEAD', 'COMPRADOR')
          AND coalesce(c."custom" -> 'bot_classification' ->> 'type', '') = '' THEN
           (CASE WHEN jsonb_typeof(c."custom") = 'object' THEN c."custom" ELSE '{}'::jsonb END)
           || jsonb_build_object(
                'bot_classification',
                (CASE WHEN jsonb_typeof(c."custom" -> 'bot_classification') = 'object'
                      THEN c."custom" -> 'bot_classification' ELSE '{}'::jsonb END)
                || jsonb_build_object('type', 'LEAD_COMPRADOR')
              )
         ELSE c."custom"
       END
 WHERE c."contactType" IN ('LEAD', 'COMPRADOR', 'INVERSIONISTA');

-- B2. Clasificaciones del bot guardadas con un tipo retirado → LEAD_COMPRADOR (los 17 Compradores
--     vivos, más borrados). El código ya las lee así; esto deja los datos iguales a lo que se lee.
UPDATE "propyte_crm"."contacts"
   SET "custom" = jsonb_set("custom", '{bot_classification,type}', '"LEAD_COMPRADOR"')
 WHERE jsonb_typeof("custom" -> 'bot_classification') = 'object'
   AND "custom" -> 'bot_classification' ->> 'type' IN ('LEAD', 'COMPRADOR', 'INVERSIONISTA');

-- B3. Perfiles del bot. «Agente Clientes» atiende a quien quiere comprar, rentar o invertir:
--     Lead Comprador, Prospecto y los dos Referidos. Lead Vendedor NO se le agrega: su identidad
--     le pide calificar presupuesto de compra, y a un vendedor eso no le sirve. Mientras no haya
--     un agente para vendedores, a un Lead Vendedor le contesta el bot general.
--     La condición sobre el valor actual evita pisar un cambio hecho a mano después del 29-oct.
UPDATE "propyte_crm"."bot_agent_profiles"
   SET "contactTypes" = ARRAY['LEAD_COMPRADOR', 'PROSPECTO', 'REFERIDO_DE_BROKER', 'REFERIDO_DE_CLIENTE']::"propyte_crm"."ContactType"[]
 WHERE "id" = 'c51cdb46-1cb8-41d0-9b89-2b8066e4f155'
   AND "contactTypes" = ARRAY['LEAD', 'PROSPECTO', 'COMPRADOR', 'INVERSIONISTA']::"propyte_crm"."ContactType"[];

--     Duplicado viejo (inactivo y borrado desde el 18-sep): solo se traducen los retirados.
UPDATE "propyte_crm"."bot_agent_profiles"
   SET "contactTypes" = ARRAY['LEAD_COMPRADOR', 'PROSPECTO', 'CLIENTE']::"propyte_crm"."ContactType"[]
 WHERE "id" = 'b1103cef-60d1-45e0-af71-d6815964a5a5'
   AND "contactTypes" = ARRAY['LEAD', 'PROSPECTO', 'COMPRADOR', 'CLIENTE', 'INVERSIONISTA']::"propyte_crm"."ContactType"[];

-- B4. Regla «WF3 — Anti-huérfano» (inactiva): su condición «tipo = LEAD» ya no encontraría a nadie.
UPDATE "propyte_crm"."automation_rules"
   SET "conditions" = jsonb_set(
         "conditions", '{all}',
         (SELECT jsonb_agg(
                   CASE WHEN cond ->> 'field' = 'contact.contactType' AND cond ->> 'value' = 'LEAD'
                        THEN jsonb_set(cond, '{value}', '"LEAD_COMPRADOR"') ELSE cond END
                   ORDER BY ord)
            FROM jsonb_array_elements("conditions" -> 'all') WITH ORDINALITY AS x(cond, ord))
       )
 WHERE "id" = '151cfb70-11cf-4fb8-8c26-0f4599ce100e'
   AND jsonb_typeof("conditions" -> 'all') = 'array'
   AND "conditions" -> 'all' @> '[{"field": "contact.contactType", "value": "LEAD"}]';

COMMIT;

-- Comprobación de la Parte B (todas en 0, salvo «lead_comprador», que debe dar 226):
--   SELECT
--     (SELECT count(*) FROM "propyte_crm"."contacts" WHERE "contactType" IN ('LEAD','COMPRADOR','INVERSIONISTA')) AS retirados,
--     (SELECT count(*) FROM "propyte_crm"."contacts" WHERE "contactType" = 'LEAD_COMPRADOR') AS lead_comprador,
--     (SELECT count(*) FROM "propyte_crm"."contacts"
--       WHERE "custom" -> 'bot_classification' ->> 'type' IN ('LEAD','COMPRADOR','INVERSIONISTA')) AS markers_viejos,
--     (SELECT count(*) FROM "propyte_crm"."bot_agent_profiles"
--       WHERE "contactTypes" && ARRAY['LEAD','COMPRADOR','INVERSIONISTA']::"propyte_crm"."ContactType"[]) AS perfiles_viejos,
--     (SELECT count(*) FROM "propyte_crm"."automation_rules" WHERE "conditions"::text LIKE '%"value": "LEAD"%') AS reglas_viejas;
--
-- Rollback de la Parte B: sin rollback automático. El tipo anterior de cada contacto queda en
-- record_field_changes (cronología) con la fuente de arriba; los perfiles y la regla tienen sus
-- valores anteriores escritos en las condiciones de B3 y B4.
